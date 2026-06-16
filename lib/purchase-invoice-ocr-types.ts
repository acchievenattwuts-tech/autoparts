import { z } from "zod";

import type { PurchaseProductOption } from "@/app/admin/(protected)/purchases/purchase-form-data";

/**
 * Advisory fields extracted from a supplier invoice / delivery-note image by
 * Gemini OCR. These are review aids only — they never create a purchase or mutate
 * stock/MAVG on their own. The admin reviews and confirms before any save runs
 * through the existing `createPurchase` flow.
 */
export const purchaseOcrLineSchema = z.object({
  rawText: z.string(),
  partCode: z.string().nullable(),
  qty: z.number().nullable(),
  unitCost: z.number().nullable(),
});

export const purchaseOcrResultSchema = z.object({
  supplierName: z.string().nullable(),
  referenceNo: z.string().nullable(),
  invoiceDate: z.string().nullable(),
  lines: z.array(purchaseOcrLineSchema),
});

export type PurchaseOcrLine = z.infer<typeof purchaseOcrLineSchema>;
export type PurchaseOcrResult = z.infer<typeof purchaseOcrResultSchema>;

/**
 * Upload limits shared by the client uploader and the server action. Files go
 * through Supabase Storage (not the 3mb Server Action body), so the real ceiling
 * is the Gemini inline-request budget (~20MB total). Images are downscaled
 * server-side before being sent to Gemini; PDFs are sent as-is.
 */
/** Private temp bucket name — shared by the storage module and the client uploader. */
export const PURCHASE_OCR_BUCKET = "purchase-ocr-temp";
export const PURCHASE_OCR_MAX_FILES = 10;
export const PURCHASE_OCR_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const PURCHASE_OCR_MAX_TOTAL_BYTES = 20 * 1024 * 1024;

export const isAcceptedPurchaseOcrMime = (mime: string): boolean =>
  mime.startsWith("image/") || mime === "application/pdf";

export const EMPTY_PURCHASE_OCR_RESULT: PurchaseOcrResult = {
  supplierName: null,
  referenceNo: null,
  invoiceDate: null,
  lines: [],
};

/** How a line was matched to a catalog product, used for the UI confidence badge. */
export type PurchaseOcrMatchConfidence = "code" | "near" | "none";

/**
 * One OCR line after catalog matching. `candidates` is the top-N ranked products
 * (may be empty when nothing matched). `qty`/`unitCost` fall back to 0 so the form
 * never receives null — the admin fills the blanks.
 */
export interface PurchaseOcrMatchedLine {
  rawText: string;
  partCode: string | null;
  qty: number;
  unitCost: number;
  candidates: PurchaseProductOption[];
  confidence: PurchaseOcrMatchConfidence;
}

export interface PurchaseOcrExtraction {
  supplierName: string | null;
  referenceNo: string | null;
  invoiceDate: string | null;
  lines: PurchaseOcrMatchedLine[];
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function cleanNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value * 10000) / 10000;
  }
  if (typeof value === "string") {
    const numeric = Number.parseFloat(value.replace(/[, ฿]/g, ""));
    if (Number.isFinite(numeric) && numeric >= 0) {
      return Math.round(numeric * 10000) / 10000;
    }
  }
  return null;
}

function cleanInvoiceDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, rawYear, month, day] = match;
  const year = Number(rawYear);
  // Defensively normalise a Buddhist-era year (e.g. 2569) back to C.E.
  const normalizedYear = year > 2400 ? year - 543 : year;
  return `${String(normalizedYear).padStart(4, "0")}-${month}-${day}`;
}

function stripCodeFences(text: string): string {
  return text.replace(/```(?:json)?/gi, "").trim();
}

/**
 * Extracts the first JSON value (object OR array) from the model text. Gemini
 * returns a single `{...}` for one document but a `[{...},{...}]` array when given
 * several files — so we must handle both. Picks whichever bracket opens first.
 */
function extractJsonBlock(text: string): string | null {
  const trimmed = stripCodeFences(text);
  const objStart = trimmed.indexOf("{");
  const arrStart = trimmed.indexOf("[");
  if (objStart === -1 && arrStart === -1) return null;

  const useArray = arrStart !== -1 && (objStart === -1 || arrStart < objStart);
  const closeChar = useArray ? "]" : "}";
  const start = useArray ? arrStart : objStart;
  const end = trimmed.lastIndexOf(closeChar);
  return end > start ? trimmed.slice(start, end + 1) : null;
}

function normalizeOcrLine(line: unknown): PurchaseOcrLine | null {
  if (typeof line !== "object" || line === null) return null;
  const record = line as Record<string, unknown>;
  const rawText = cleanString(record.rawText, 300);
  if (!rawText) return null;
  return {
    rawText,
    partCode: cleanString(record.partCode, 100),
    qty: cleanNumber(record.qty),
    unitCost: cleanNumber(record.unitCost),
  };
}

/**
 * Parses the Gemini OCR JSON response into a normalized, Zod-validated result.
 * Accepts either a single document object or an array of documents (one per file),
 * merging all line items. Always returns a value (empty on any parse/validation
 * failure) — never throws. Pure (no server deps) so it is unit-testable.
 */
export function parsePurchaseInvoiceOcr(raw: string): PurchaseOcrResult {
  const jsonText = extractJsonBlock(raw);
  if (!jsonText) return EMPTY_PURCHASE_OCR_RESULT;

  try {
    const parsed: unknown = JSON.parse(jsonText);
    const docs: Record<string, unknown>[] = (Array.isArray(parsed) ? parsed : [parsed]).filter(
      (doc): doc is Record<string, unknown> => typeof doc === "object" && doc !== null,
    );
    if (docs.length === 0) return EMPTY_PURCHASE_OCR_RESULT;

    let supplierName: string | null = null;
    let referenceNo: string | null = null;
    let invoiceDate: string | null = null;
    const lines: PurchaseOcrLine[] = [];

    for (const doc of docs) {
      supplierName ??= cleanString(doc.supplierName, 200);
      referenceNo ??= cleanString(doc.referenceNo, 100);
      invoiceDate ??= cleanInvoiceDate(doc.invoiceDate);
      const rawLines = Array.isArray(doc.lines) ? doc.lines : [];
      for (const line of rawLines) {
        const normalized = normalizeOcrLine(line);
        if (normalized) lines.push(normalized);
      }
    }

    const result = purchaseOcrResultSchema.safeParse({
      supplierName,
      referenceNo,
      invoiceDate,
      lines,
    });
    return result.success ? result.data : EMPTY_PURCHASE_OCR_RESULT;
  } catch {
    return EMPTY_PURCHASE_OCR_RESULT;
  }
}
