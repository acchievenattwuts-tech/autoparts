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

function extractJson(text: string): string | null {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : null;
}

/**
 * Parses the Gemini OCR JSON response into a normalized, Zod-validated result.
 * Always returns a value (empty on any parse/validation failure) — never throws.
 * Pure (no server deps) so it is unit-testable without Gemini keys.
 */
export function parsePurchaseInvoiceOcr(raw: string): PurchaseOcrResult {
  const jsonText = extractJson(raw);
  if (!jsonText) return EMPTY_PURCHASE_OCR_RESULT;

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const rawLines = Array.isArray(parsed.lines) ? parsed.lines : [];

    const normalized: PurchaseOcrResult = {
      supplierName: cleanString(parsed.supplierName, 200),
      referenceNo: cleanString(parsed.referenceNo, 100),
      invoiceDate: cleanInvoiceDate(parsed.invoiceDate),
      lines: rawLines
        .map((line): PurchaseOcrLine | null => {
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
        })
        .filter((line): line is PurchaseOcrLine => line !== null),
    };

    const result = purchaseOcrResultSchema.safeParse(normalized);
    return result.success ? result.data : EMPTY_PURCHASE_OCR_RESULT;
  } catch {
    return EMPTY_PURCHASE_OCR_RESULT;
  }
}
