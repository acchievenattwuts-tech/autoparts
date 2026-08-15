import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { parseLiffPaymentQrRequest } from "@/lib/liff-payment-qr-request";
import { resolveLiffPaymentTarget } from "@/lib/liff-payment-qr-target";
import { getLiffCustomerSession } from "@/lib/liff-session";
import { buildPaymentQrImageUrl } from "@/lib/payment-qr-image-token";
import { buildPromptPayQrDataUrl, getPrimaryTransferAccount } from "@/lib/payment-qr";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;

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
      resolveLiffPaymentTarget(input, customer.id),
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

    // Rendered at 220 CSS px in the LIFF sheet; generate at 2x so the QR stays crisp on
    // high-DPI phones and when the customer saves/zooms the image.
    const qrDataUrl = await buildPromptPayQrDataUrl(transferAccount.promptPayId, amount, 440);
    if (!qrDataUrl) {
      return NextResponse.json({ error: "ไม่สามารถสร้าง PromptPay QR ได้" }, { status: 500 });
    }

    return NextResponse.json(
      {
        amount,
        label: paymentTarget.label,
        qrDataUrl,
        // Null when DOC_VERIFY_SECRET is unset — the client then hides the
        // open-in-browser action instead of offering a link that cannot work.
        imageUrl: buildPaymentQrImageUrl(amount),
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
