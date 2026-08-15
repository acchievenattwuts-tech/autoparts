import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getLineDailySummaryConfig, pushLineMessages } from "@/lib/line-messaging";
import { parseLiffPaymentQrRequest } from "@/lib/liff-payment-qr-request";
import { resolveLiffPaymentTarget } from "@/lib/liff-payment-qr-target";
import { getLiffCustomerSession } from "@/lib/liff-session";
import { buildPaymentQrImageUrl } from "@/lib/payment-qr-image-token";
import { getPrimaryTransferAccount } from "@/lib/payment-qr";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Tighter than the QR preview endpoint: every call spends one LINE push message from
// the shop's monthly quota, so a stuck finger must not drain it.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 5;

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export async function POST(request: Request) {
  const session = await getLiffCustomerSession();
  if (!session) {
    return NextResponse.json({ error: "กรุณาเปิดผ่าน LINE และเข้าสู่ระบบใหม่" }, { status: 401 });
  }

  const rate = await checkRateLimit({
    key: `liff-payment-qr-send:${session.lineUserId}`,
    limit: RATE_LIMIT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (!rate.ok) {
    return NextResponse.json(
      { error: "ส่ง QR บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่" },
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

    const { channelAccessToken } = getLineDailySummaryConfig();
    if (!channelAccessToken) {
      return NextResponse.json(
        { error: "ร้านยังไม่ได้เชื่อมต่อ LINE สำหรับส่งข้อความ กรุณาบันทึกรูป QR แทน" },
        { status: 503 },
      );
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
    if (paymentTarget.amount <= 0) {
      return NextResponse.json({ error: "ไม่มียอดค้างชำระสำหรับสร้าง QR" }, { status: 409 });
    }

    const imageUrl = buildPaymentQrImageUrl(paymentTarget.amount);
    if (!imageUrl) {
      return NextResponse.json(
        { error: "ระบบยังตั้งค่าไม่ครบสำหรับส่ง QR เข้าแชท กรุณาบันทึกรูป QR แทน" },
        { status: 503 },
      );
    }

    const bankLabel = transferAccount.bankName ?? transferAccount.name;
    await pushLineMessages({
      channelAccessToken,
      recipientIds: [session.lineUserId],
      messages: [
        {
          type: "text",
          text: [
            `QR ชำระเงิน · ${paymentTarget.label}`,
            `ยอด ${formatMoney(paymentTarget.amount)} บาท`,
            `${bankLabel} · PromptPay ${transferAccount.promptPayId}`,
            "",
            "แตะที่รูป QR ด้านล่างเพื่อบันทึกลงเครื่อง แล้วเปิดแอปธนาคาร เลือกสแกน QR จากรูปภาพ",
            "กรุณาตรวจชื่อผู้รับและยอดก่อนยืนยันทุกครั้ง",
          ].join("\n"),
        },
        {
          type: "image",
          originalContentUrl: imageUrl,
          previewImageUrl: imageUrl,
        },
      ],
    });

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[liff/payment-qr/send]", error);
    return NextResponse.json(
      { error: "ส่ง QR เข้าแชทไม่สำเร็จ กรุณาลองใหม่ หรือกดบันทึกรูป QR แทน" },
      { status: 500 },
    );
  }
}
