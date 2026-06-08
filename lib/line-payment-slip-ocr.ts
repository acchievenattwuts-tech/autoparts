import { generateGeminiContent } from "@/lib/google-ai-client";
import { hasGeminiKeysConfigured } from "@/lib/google-ai-keys";
import { fetchLineMessageContent, type LineMessageContent } from "@/lib/line-messaging";
import {
  EMPTY_PAYMENT_SLIP_OCR,
  parsePaymentSlipOcr,
  type PaymentSlipOcr,
} from "@/lib/line-payment-slip-service";

const OCR_PROMPT = [
  "คุณเป็นผู้ช่วยอ่านข้อมูลจากสลิป/หลักฐานการโอนเงินของธนาคารไทย",
  "อ่านเฉพาะข้อมูลที่เห็นจริงในรูป ห้ามเดาหรือแต่งข้อมูลที่อ่านไม่ออก ถ้าไม่พบให้ใส่ null",
  "ตอบเป็น JSON ล้วนเท่านั้น ห้ามมี markdown:",
  "{",
  '  "amount": ตัวเลขจำนวนเงิน หรือ null,',
  '  "transferDatetime": วันเวลาโอนรูปแบบ ISO 8601 (เช่น 2026-06-08T14:30:00+07:00) หรือ null,',
  '  "bank": ชื่อธนาคาร หรือ null,',
  '  "senderName": ชื่อผู้โอน หรือ null,',
  '  "receiverName": ชื่อผู้รับ หรือ null,',
  '  "referenceNo": เลขอ้างอิง/รหัสรายการ หรือ null,',
  '  "rawText": ข้อความสำคัญที่อ่านได้ หรือ null',
  "}",
].join("\n");

/**
 * Runs OCR on already-fetched image bytes (so the LINE content is fetched only
 * once and reused for both OCR and image storage). Returns empty OCR (never
 * throws) when keys are missing, the content isn't an image, or parsing fails.
 */
export async function runPaymentSlipOcr(content: LineMessageContent | null): Promise<PaymentSlipOcr> {
  if (!content || !content.mimeType.startsWith("image/") || !hasGeminiKeysConfigured()) {
    return EMPTY_PAYMENT_SLIP_OCR;
  }

  try {
    const { text } = await generateGeminiContent({
      prompt: OCR_PROMPT,
      images: [{ mimeType: content.mimeType, dataBase64: content.dataBase64 }],
      json: true,
      maxOutputTokens: 500,
      temperature: 0,
    });
    return parsePaymentSlipOcr(text);
  } catch {
    return EMPTY_PAYMENT_SLIP_OCR;
  }
}

/**
 * Fetches a slip image from LINE then runs OCR. Kept for callers that only need
 * the extracted fields (no image storage).
 */
export async function extractPaymentSlipOcr(input: {
  channelAccessToken: string | null;
  lineMessageId: string | null;
}): Promise<PaymentSlipOcr> {
  if (!input.channelAccessToken || !input.lineMessageId) {
    return EMPTY_PAYMENT_SLIP_OCR;
  }

  try {
    const content = await fetchLineMessageContent({
      channelAccessToken: input.channelAccessToken,
      messageId: input.lineMessageId,
    });
    return runPaymentSlipOcr(content);
  } catch {
    return EMPTY_PAYMENT_SLIP_OCR;
  }
}
