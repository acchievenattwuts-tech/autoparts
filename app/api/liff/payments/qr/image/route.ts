import { NextResponse } from "next/server";

import { verifyPaymentQrImageToken } from "@/lib/payment-qr-image-token";
import { buildPromptPayQrPngBuffer, getPrimaryTransferAccount } from "@/lib/payment-qr";

export const dynamic = "force-dynamic";

// Large enough to stay sharp when the customer saves it to the gallery and their bank
// app scans it from the photo, still far below LINE's 1MB preview-image cap.
const CHAT_QR_WIDTH = 720;

// ASCII only: browsers drop a non-ASCII filename in Content-Disposition unless it is
// RFC 5987 encoded, which would leave the saved file with a random name.
const QR_FILE_NAME = "promptpay-qr.png";

/**
 * Public on purpose: LINE's servers fetch this URL when a QR is pushed into a customer
 * chat, and the external browser that opens it for "save image" carries no LIFF cookie.
 * The signed token in the query string is the only authorisation — see
 * lib/payment-qr-image-token.ts for why it carries the amount and nothing else.
 */
export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const token = searchParams.get("token");
    // `?download=1` is what the LIFF "บันทึก QR" button opens in the external browser:
    // an attachment disposition makes Chrome/Safari save the PNG without any further tap.
    const asAttachment = searchParams.get("download") === "1";
    const payload = verifyPaymentQrImageToken(token);
    // Same response for missing, tampered, and expired tokens so the endpoint cannot be
    // used to probe which links were ever valid.
    if (!payload) {
      return NextResponse.json({ error: "ลิงก์ QR หมดอายุหรือไม่ถูกต้อง" }, { status: 404 });
    }

    const transferAccount = await getPrimaryTransferAccount();
    if (!transferAccount?.promptPayId?.trim()) {
      return NextResponse.json({ error: "ยังไม่ได้ตั้งค่าบัญชี PromptPay" }, { status: 404 });
    }

    const png = await buildPromptPayQrPngBuffer(
      transferAccount.promptPayId,
      payload.amount,
      CHAT_QR_WIDTH,
    );
    if (!png) {
      return NextResponse.json({ error: "ไม่สามารถสร้าง PromptPay QR ได้" }, { status: 500 });
    }

    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(png.byteLength),
        // The token already bounds the lifetime; let LINE's media proxy and the browser
        // keep the bytes so a saved chat image never re-hits the database.
        "Cache-Control": "public, max-age=1800, immutable",
        "Content-Disposition": `${asAttachment ? "attachment" : "inline"}; filename="${QR_FILE_NAME}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[liff/payment-qr/image]", error);
    return NextResponse.json({ error: "ไม่สามารถสร้าง QR ได้" }, { status: 500 });
  }
}
