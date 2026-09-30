import { z } from "zod";

import type { PurchaseProductOption } from "@/app/admin/(protected)/purchases/purchase-form-data";
import { calcVat, VAT_TYPE_LABELS, type VatType } from "@/lib/vat";

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
  // V6: the invoice's tax data — line unitCost is the price as printed, `vatIncluded` says
  // whether those printed prices already include VAT (null when the document shows no VAT).
  taxInvoiceNo: z.string().nullable(),
  taxInvoiceDate: z.string().nullable(),
  vatIncluded: z.boolean().nullable(),
  vatRate: z.number().nullable(),
  vatAmount: z.number().nullable(),
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

const PURCHASE_OCR_MIME_MAX_LENGTH = 100;

const requestedOcrMimeSchema = z
  .string()
  .max(PURCHASE_OCR_MIME_MAX_LENGTH)
  .refine(isAcceptedPurchaseOcrMime);
const requestedOcrSizeSchema = z.number().int().positive().max(PURCHASE_OCR_MAX_FILE_BYTES);

/**
 * Server-side validation of the client-declared upload list (the values come from
 * the browser, so types are not trusted). Returns the Thai error to show, or null
 * when the request is acceptable.
 */
export const validatePurchaseOcrUploadRequest = (files: unknown): string | null => {
  if (!Array.isArray(files) || files.length === 0) {
    return "กรุณาแนบไฟล์อย่างน้อย 1 ไฟล์";
  }
  if (files.length > PURCHASE_OCR_MAX_FILES) {
    return `แนบไฟล์ได้ไม่เกิน ${PURCHASE_OCR_MAX_FILES} ไฟล์ต่อครั้ง`;
  }

  let total = 0;
  for (const file of files as unknown[]) {
    const entry = (typeof file === "object" && file !== null ? file : {}) as Record<string, unknown>;
    if (!requestedOcrMimeSchema.safeParse(entry.mimeType).success) {
      return "รองรับเฉพาะไฟล์รูปภาพหรือ PDF เท่านั้น";
    }
    const size = requestedOcrSizeSchema.safeParse(entry.size);
    if (!size.success) {
      return "ขนาดไฟล์ต้องไม่เกิน 15MB ต่อไฟล์";
    }
    total += size.data;
  }
  if (total > PURCHASE_OCR_MAX_TOTAL_BYTES) {
    return "ขนาดไฟล์รวมต้องไม่เกิน 20MB";
  }
  return null;
};

export const EMPTY_PURCHASE_OCR_RESULT: PurchaseOcrResult = {
  supplierName: null,
  referenceNo: null,
  invoiceDate: null,
  taxInvoiceNo: null,
  taxInvoiceDate: null,
  vatIncluded: null,
  vatRate: null,
  vatAmount: null,
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
  taxInvoiceNo: string | null;
  taxInvoiceDate: string | null;
  vatIncluded: boolean | null;
  vatRate: number | null;
  vatAmount: number | null;
  lines: PurchaseOcrMatchedLine[];
}

/** One line's match query sent to the chunked matcher (client → server). */
export interface PurchaseOcrMatchQuery {
  rawText: string;
  partCode: string | null;
}

/** Match result for one line (server → client), aligned by index with the query. */
export interface PurchaseOcrLineMatch {
  candidates: PurchaseProductOption[];
  confidence: PurchaseOcrMatchConfidence;
}

/** Max lines per chunked match request — keeps each request well within the timeout. */
export const PURCHASE_OCR_MATCH_CHUNK_SIZE = 20;

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

const MAX_VAT_RATE_PERCENT = 100;

function cleanVatRate(value: unknown): number | null {
  const rate = cleanNumber(value);
  return rate !== null && rate > 0 && rate <= MAX_VAT_RATE_PERCENT ? rate : null;
}

function cleanBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
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
    let taxInvoiceNo: string | null = null;
    let taxInvoiceDate: string | null = null;
    let vatIncluded: boolean | null = null;
    let vatRate: number | null = null;
    let vatAmount: number | null = null;
    const lines: PurchaseOcrLine[] = [];

    for (const doc of docs) {
      supplierName ??= cleanString(doc.supplierName, 200);
      referenceNo ??= cleanString(doc.referenceNo, 100);
      invoiceDate ??= cleanInvoiceDate(doc.invoiceDate);
      taxInvoiceNo ??= cleanString(doc.taxInvoiceNo, 100);
      taxInvoiceDate ??= cleanInvoiceDate(doc.taxInvoiceDate);
      vatIncluded ??= cleanBoolean(doc.vatIncluded);
      vatRate ??= cleanVatRate(doc.vatRate);
      vatAmount ??= cleanNumber(doc.vatAmount);
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
      taxInvoiceNo,
      taxInvoiceDate,
      vatIncluded,
      vatRate,
      vatAmount,
      lines,
    });
    return result.success ? result.data : EMPTY_PURCHASE_OCR_RESULT;
  } catch {
    return EMPTY_PURCHASE_OCR_RESULT;
  }
}

// ─── V6: OCR tax data → purchase form VAT fields ─────────────────────────────

/** Thai standard VAT rate — used only when the invoice shows VAT but its rate cannot be read. */
export const PURCHASE_OCR_FALLBACK_VAT_RATE = 7;
/** Baht difference between the invoice's VAT and the VAT recomputed from its lines that is flagged for review. */
const OCR_VAT_CROSS_CHECK_TOLERANCE = 1;

export interface PurchaseOcrFormVat {
  vatType: VatType;
  vatRate: number;
  /** null → leave the form's value as it is. */
  taxInvoiceNo: string | null;
  taxInvoiceDate: string | null;
  /** Thai review notes: every assumption the mapping made. */
  notes: string[];
}

type PurchaseOcrTaxData = Pick<
  PurchaseOcrResult,
  "taxInvoiceNo" | "taxInvoiceDate" | "vatIncluded" | "vatRate" | "vatAmount"
>;

const formatBaht = (value: number): string => value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "ราคารวม VAT 7%" / "ไม่มีภาษี" — how the mapping will set the form. */
export function describePurchaseOcrVat(vat: Pick<PurchaseOcrFormVat, "vatType" | "vatRate">): string {
  return vat.vatType === "NO_VAT" ? VAT_TYPE_LABELS.NO_VAT : `${VAT_TYPE_LABELS[vat.vatType]} ${vat.vatRate}%`;
}

/**
 * Maps the OCR tax data of an invoice onto the purchase form (owner decision V6). Line prices stay
 * exactly as printed and the VAT type follows how they were printed — prices that include VAT →
 * INCLUDING_VAT, prices before VAT with VAT added at the bottom → EXCLUDING_VAT, no VAT on the
 * document → NO_VAT — so the saved purchase pays (and costs) what the invoice says. Every
 * assumption is returned as a Thai note; the admin still reviews before saving.
 */
export function mapPurchaseOcrVatToForm(
  ocr: PurchaseOcrTaxData,
  lines: ReadonlyArray<{ qty: number | null; unitCost: number | null }>,
): PurchaseOcrFormVat {
  const rate = ocr.vatRate !== null && ocr.vatRate > 0 && ocr.vatRate <= MAX_VAT_RATE_PERCENT ? ocr.vatRate : null;
  const amount = ocr.vatAmount !== null && ocr.vatAmount > 0 ? ocr.vatAmount : null;
  const notes: string[] = [];
  const hasVat = rate !== null || amount !== null || ocr.vatIncluded !== null;

  if (!hasVat) {
    notes.push("ไม่พบ VAT บนเอกสาร จึงตั้งเป็น \"ไม่มีภาษี\" ถ้าเอกสารมี VAT กรุณาเลือกประเภทภาษีเอง");
    return { vatType: "NO_VAT", vatRate: 0, taxInvoiceNo: ocr.taxInvoiceNo, taxInvoiceDate: ocr.taxInvoiceDate, notes };
  }

  const vatRate = rate ?? PURCHASE_OCR_FALLBACK_VAT_RATE;
  if (rate === null) notes.push(`อ่านอัตรา VAT จากเอกสารไม่ได้ จึงตั้งไว้ ${PURCHASE_OCR_FALLBACK_VAT_RATE}% กรุณาตรวจสอบ`);
  if (ocr.vatIncluded === null) {
    notes.push("อ่านไม่ได้ว่าราคาต่อหน่วยรวม VAT แล้วหรือยัง จึงตั้งเป็น \"ราคาไม่รวม VAT\" กรุณาตรวจสอบ");
  }
  const vatType: VatType = ocr.vatIncluded === true ? "INCLUDING_VAT" : "EXCLUDING_VAT";

  if (amount !== null) {
    const linesTotal = lines.reduce((sum, line) => sum + (line.qty ?? 0) * (line.unitCost ?? 0), 0);
    const recomputed = linesTotal > 0 ? calcVat(linesTotal, vatType, vatRate).vatAmount : null;
    if (recomputed !== null && Math.abs(recomputed - amount) > OCR_VAT_CROSS_CHECK_TOLERANCE) {
      notes.push(
        `VAT ที่คำนวณจากรายการ (${formatBaht(recomputed)} บาท) ไม่ตรงกับเอกสาร (${formatBaht(amount)} บาท) ` +
          "อาจมีส่วนลด/ค่าส่งท้ายบิล หรือราคาต่อหน่วยอ่านผิด กรุณาตรวจสอบ",
      );
    }
  }
  if (!ocr.taxInvoiceNo) notes.push("ไม่พบเลขที่ใบกำกับภาษี กรุณากรอกเอง");
  if (!ocr.taxInvoiceDate) notes.push("ไม่พบวันที่ใบกำกับภาษี กรุณากรอกเอง");

  return { vatType, vatRate, taxInvoiceNo: ocr.taxInvoiceNo, taxInvoiceDate: ocr.taxInvoiceDate, notes };
}
