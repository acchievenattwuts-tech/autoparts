import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  parseLiffPaymentQrRequest,
  type LiffPaymentQrRequest,
} from "@/lib/liff-payment-qr-request";
import { getLiffCustomerSession } from "@/lib/liff-session";
import { buildPromptPayQrDataUrl, getPrimaryTransferAccount } from "@/lib/payment-qr";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;

function toPaymentAmount(value: unknown): number {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

async function resolvePaymentTarget(input: LiffPaymentQrRequest, customerId: string) {
  const commonWhere = {
    customerId,
    status: "ACTIVE" as const,
    paymentType: "CREDIT_SALE" as const,
    amountRemain: { gt: 0 },
  };

  if (input.mode === "selected") {
    const sales = await db.sale.findMany({
      where: { ...commonWhere, id: { in: input.saleIds } },
      select: { id: true, amountRemain: true },
    });
    if (sales.length !== input.saleIds.length) return null;

    return {
      amount: toPaymentAmount(
        sales.reduce((sum, sale) => sum + Number(sale.amountRemain), 0),
      ),
      label: `บิลที่เลือก ${sales.length} บิล`,
    };
  }

  const result = await db.sale.aggregate({
    where: commonWhere,
    _sum: { amountRemain: true },
  });
  return {
    amount: toPaymentAmount(result._sum.amountRemain),
    label: "ยอดค้างชำระทั้งหมด",
  };
}

export async function POST(request: Request) {
  const session = await getLiffCustomerSession();
  if (!session) {
    return NextResponse.json({ error: "กรุณาเปิดผ่าน LINE และเข้าสู่ระบบใหม่" }, { status: 401 });
  }

  const rate = await checkRateLimit({
    key: `liff-payment-qr:${session.lineUserId}`,
    limit: RATE_LIMIT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (!rate.ok) {
    return NextResponse.json(
      { error: "สร้าง QR บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)) },
      },
    );
  }

  try {
    const input = parseLiffPaymentQrRequest(await request.json());
    if (!input) {
      return NextResponse.json({ error: "ข้อมูลสำหรับสร้าง QR ไม่ถูกต้อง" }, { status: 400 });
    }

    const customer = await db.customer.findFirst({
      where: {
        id: session.customerId,
        lineUserId: session.lineUserId,
        isActive: true,
      },
      select: { id: true },
    });
    if (!customer) {
      return NextResponse.json({ error: "ไม่พบบัญชีลูกค้าที่เชื่อมกับ LINE" }, { status: 403 });
    }

    const [transferAccount, paymentTarget] = await Promise.all([
      getPrimaryTransferAccount(),
      resolvePaymentTarget(input, customer.id),
    ]);

    if (!transferAccount?.promptPayId?.trim()) {
      return NextResponse.json(
        { error: "ร้านยังไม่ได้ตั้งค่าบัญชี PromptPay สำหรับรับชำระ" },
        { status: 409 },
      );
    }

    if (!paymentTarget) {
      return NextResponse.json({ error: "ไม่พบบิลค้างชำระนี้ หรือบิลถูกชำระแล้ว" }, { status: 404 });
    }

    const amount = paymentTarget.amount;
    if (amount <= 0) {
      return NextResponse.json({ error: "ไม่มียอดค้างชำระสำหรับสร้าง QR" }, { status: 409 });
    }

    const qrDataUrl = await buildPromptPayQrDataUrl(transferAccount.promptPayId, amount);
    if (!qrDataUrl) {
      return NextResponse.json({ error: "ไม่สามารถสร้าง PromptPay QR ได้" }, { status: 500 });
    }

    return NextResponse.json(
      {
        amount,
        label: paymentTarget.label,
        qrDataUrl,
        account: {
          name: transferAccount.name,
          bankName: transferAccount.bankName,
          accountNo: transferAccount.accountNo,
          promptPayId: transferAccount.promptPayId,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[liff/payment-qr]", error);
    return NextResponse.json({ error: "ไม่สามารถสร้าง QR ได้ กรุณาลองใหม่" }, { status: 500 });
  }
}
