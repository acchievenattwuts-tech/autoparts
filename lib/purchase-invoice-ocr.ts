import { generateGeminiContent } from "@/lib/google-ai-client";
import { hasGeminiKeysConfigured } from "@/lib/google-ai-keys";
import {
  EMPTY_PURCHASE_OCR_RESULT,
  parsePurchaseInvoiceOcr,
  type PurchaseOcrResult,
} from "@/lib/purchase-invoice-ocr-types";

const OCR_PROMPT = [
  "คุณเป็นผู้ช่วยอ่านใบส่งของ/ใบกำกับภาษีของซัพพลายเออร์อะไหล่รถยนต์ในไทย",
  "อาจมีหลายรูป (ใบหลายหน้า) ให้รวมรายการสินค้าทั้งหมดจากทุกรูปเข้าด้วยกัน",
  "อ่านเฉพาะข้อมูลที่เห็นจริงในรูป ห้ามเดาหรือแต่งข้อมูลที่อ่านไม่ออก ถ้าไม่พบให้ใส่ null",
  "ตอบเป็น JSON ล้วนเท่านั้น ห้ามมี markdown:",
  "{",
  '  "supplierName": ชื่อผู้ขาย หรือ null,',
  '  "referenceNo": เลขที่ใบกำกับ/ใบส่งของ หรือ null,',
  '  "invoiceDate": วันที่บนเอกสารรูปแบบ "YYYY-MM-DD" (ค.ศ.) หรือ null,',
  '  "lines": [',
  '    {',
  '      "rawText": ข้อความบรรทัดสินค้าที่อ่านได้,',
  '      "partCode": รหัสอะไหล่/เลขพาร์ท หรือ null,',
  '      "qty": จำนวน (ตัวเลข) หรือ null,',
  '      "unitCost": ราคาต่อหน่วยก่อน VAT (ตัวเลข) หรือ null',
  '    }',
  '  ]',
  "}",
  "อ่านเฉพาะบรรทัดที่เป็นรายการสินค้า ข้ามหัวตาราง ยอดรวม ภาษี และส่วนท้ายเอกสาร",
].join("\n");

export interface PurchaseOcrImageInput {
  mimeType: string;
  dataBase64: string;
}

// One supplier invoice can hold many line items across pages — give Gemini enough
// output budget so the JSON array isn't truncated.
const MAX_OCR_OUTPUT_TOKENS = 4000;

/**
 * Runs OCR on one or more already-decoded invoice images and returns the parsed,
 * normalized result. Returns an empty result (never throws) when no images are
 * provided, Gemini keys are missing, or parsing fails — so the caller degrades to
 * a fully manual purchase form.
 */
export async function runPurchaseInvoiceOcr(
  images: PurchaseOcrImageInput[],
): Promise<PurchaseOcrResult> {
  if (images.length === 0 || !hasGeminiKeysConfigured()) {
    return EMPTY_PURCHASE_OCR_RESULT;
  }

  try {
    const { text } = await generateGeminiContent({
      prompt: OCR_PROMPT,
      images: images.map((image) => ({
        mimeType: image.mimeType,
        dataBase64: image.dataBase64,
      })),
      json: true,
      maxOutputTokens: MAX_OCR_OUTPUT_TOKENS,
      temperature: 0,
      // Extraction task — disable thinking so reasoning tokens don't truncate the JSON.
      thinkingLevel: "NONE",
    });
    return parsePurchaseInvoiceOcr(text);
  } catch {
    return EMPTY_PURCHASE_OCR_RESULT;
  }
}
