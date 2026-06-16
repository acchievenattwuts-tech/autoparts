import { generateGeminiContent } from "@/lib/google-ai-client";
import { hasGeminiKeysConfigured } from "@/lib/google-ai-keys";
import {
  EMPTY_PURCHASE_OCR_RESULT,
  parsePurchaseInvoiceOcr,
  type PurchaseOcrResult,
} from "@/lib/purchase-invoice-ocr-types";

const OCR_PROMPT = [
  "คุณเป็นผู้ช่วยอ่านใบส่งของ/ใบกำกับภาษีของซัพพลายเออร์อะไหล่รถยนต์ในไทย",
  "ข้อมูลอาจมาเป็นรูปหลายใบหรือไฟล์ PDF หลายหน้า ให้รวมรายการสินค้าทั้งหมดจากทุกหน้าเข้าด้วยกัน",
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

// Multiple multi-line invoices in one request can produce a long JSON array — give
// Gemini a generous output budget so it isn't truncated (truncation → parse → 0 lines).
const MAX_OCR_OUTPUT_TOKENS = 8000;
// A heavy invoice can legitimately take ~30-45s to extract; give one key that long,
// but only try 2 keys so a slow/timing-out streak can't stack past the function limit.
const OCR_CALL_TIMEOUT_MS = 45_000;
const OCR_MAX_KEY_ATTEMPTS = 2;

/** Why an OCR run produced no usable lines — lets the caller report a precise reason. */
export type PurchaseOcrRunStatus = "ok" | "no_keys" | "ai_error";

export interface PurchaseOcrRun {
  result: PurchaseOcrResult;
  status: PurchaseOcrRunStatus;
  /** Raw Gemini text (server-side diagnosis only). Empty on no_keys/ai_error. */
  rawText: string;
  /** Short reason on ai_error (e.g. the Gemini HTTP message), for diagnosis. */
  detail?: string;
}

/**
 * Runs OCR on one or more already-decoded invoice files. Never throws — returns a
 * status so the caller can distinguish "AI unavailable / errored" from "read fine
 * but found no line items". The underlying Gemini error (e.g. HTTP 4xx body) is
 * logged server-side for diagnosis.
 */
export async function runPurchaseInvoiceOcr(
  images: PurchaseOcrImageInput[],
): Promise<PurchaseOcrRun> {
  if (images.length === 0 || !hasGeminiKeysConfigured()) {
    return { result: EMPTY_PURCHASE_OCR_RESULT, status: "no_keys", rawText: "" };
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
      // Cap key rotation + per-call time: a very heavy document (e.g. a 200-row
      // price list) used to time out on key after key (30s each), stacking past the
      // function limit (504). Try at most 2 keys with a generous single-call timeout.
      timeoutMs: OCR_CALL_TIMEOUT_MS,
      maxKeyAttempts: OCR_MAX_KEY_ATTEMPTS,
    });
    const result = parsePurchaseInvoiceOcr(text);
    console.info("[purchase-ocr] gemini ok", {
      files: images.length,
      rawLength: text.length,
      lines: result.lines.length,
    });
    return { result, status: "ok", rawText: text };
  } catch (error) {
    // error.message carries the real cause, e.g. ALL_GEMINI_KEYS_FAILED:GEMINI_HTTP_400:...
    const message = error instanceof Error ? error.message : String(error);
    console.error("[purchase-ocr] gemini failed", message);
    return {
      result: EMPTY_PURCHASE_OCR_RESULT,
      status: "ai_error",
      rawText: "",
      detail: message.slice(0, 160),
    };
  }
}
