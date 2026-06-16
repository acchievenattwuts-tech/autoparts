"use server";

import sharp from "sharp";

import { db } from "@/lib/db";
import { isInventoryTracked } from "@/lib/inventory-tracking";
import { searchProductIds } from "@/lib/product-search";
import { requirePermission } from "@/lib/require-auth";
import { runPurchaseInvoiceOcr } from "@/lib/purchase-invoice-ocr";
import {
  isAcceptedPurchaseOcrMime,
  PURCHASE_OCR_MAX_FILES,
  PURCHASE_OCR_MAX_FILE_BYTES,
  PURCHASE_OCR_MAX_TOTAL_BYTES,
  type PurchaseOcrExtraction,
  type PurchaseOcrLine,
  type PurchaseOcrMatchConfidence,
  type PurchaseOcrMatchedLine,
} from "@/lib/purchase-invoice-ocr-types";
import {
  createPurchaseOcrUploadTickets,
  deletePurchaseOcrFiles,
  fetchPurchaseOcrFile,
  type PurchaseOcrUploadTicket,
} from "@/lib/purchase-invoice-storage";
import type { PurchaseProductOption } from "./purchase-form-data";

const CANDIDATES_PER_LINE = 3;
// Match lines in small batches, not all at once: the DB pool is intentionally tiny
// (max:1 per serverless instance), so fanning out one query per line exhausts it on
// large invoices ("timeout exceeded when trying to connect").
const MATCH_CONCURRENCY = 3;
// Each line may trigger a semantic-search embedding (a Gemini network call). Bound
// per-line and overall time so a many-row PDF can't blow the function timeout (504).
// Lines left over after the budget simply have no candidates — the admin searches them.
const MATCH_PER_LINE_TIMEOUT_MS = 8_000;
const MATCH_TOTAL_BUDGET_MS = 25_000;
const IMAGE_MAX_DIMENSION = 2048;
const IMAGE_JPEG_QUALITY = 85;
// base64 inflates raw bytes by ~33%; keep the summed send bytes under this so the
// Gemini inline request stays within its ~20MB total budget.
const GEMINI_SEND_BUDGET_BYTES = 14 * 1024 * 1024;

const GENERIC_ERROR = "เกิดข้อผิดพลาดในการอ่านไฟล์ กรุณาลองใหม่";

type ExtractResult = { error: string } | { data: PurchaseOcrExtraction };

export interface RequestedOcrFile {
  mimeType: string;
  size: number;
}

export interface StoredOcrFile {
  path: string;
  mimeType: string;
}

/**
 * Loads catalog products for the matched ids and maps them to the exact shape the
 * purchase form consumes, preserving the search rank order.
 */
async function loadProductOptions(ids: string[]): Promise<PurchaseProductOption[]> {
  if (ids.length === 0) return [];

  const rows = await db.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      purchaseUnitName: true,
      costPrice: true,
      inventoryTracking: true,
      isLotControl: true,
      requireExpiryDate: true,
      category: { select: { name: true } },
      brand: { select: { name: true } },
      aliases: { select: { alias: true } },
      units: {
        select: { name: true, scale: true, isBase: true },
        orderBy: { isBase: "desc" },
      },
    },
  });

  const byId = new Map<string, PurchaseProductOption>(
    rows.map((product) => [
      product.id,
      {
        id: product.id,
        code: product.code,
        name: product.name,
        description: product.description,
        purchaseUnitName: product.purchaseUnitName,
        costPrice: Number(product.costPrice),
        categoryName: product.category.name,
        brandName: product.brand?.name ?? null,
        aliases: product.aliases.map((alias) => alias.alias),
        units: product.units.map((unit) => ({
          name: unit.name,
          scale: Number(unit.scale),
          isBase: unit.isBase,
        })),
        isLotControl: isInventoryTracked(product.inventoryTracking) && product.isLotControl,
        requireExpiryDate: product.requireExpiryDate,
      },
    ]),
  );

  return ids
    .map((id) => byId.get(id))
    .filter((option): option is PurchaseProductOption => Boolean(option));
}

/**
 * Matches one OCR line to catalog products. A real part number is tried first
 * (most precise); only when that yields nothing do we fall back to a semantic
 * search over the line text. Never auto-picks — returns ranked candidates.
 */
async function matchLine(line: PurchaseOcrLine): Promise<PurchaseOcrMatchedLine> {
  let ids: string[] = [];
  let confidence: PurchaseOcrMatchConfidence = "none";

  const partCode = line.partCode?.trim();
  if (partCode) {
    const byCode = await searchProductIds({
      query: partCode,
      isActive: true,
      take: CANDIDATES_PER_LINE,
      cacheProfile: "admin",
    });
    if (byCode.ids.length > 0) {
      ids = byCode.ids;
      confidence = "code";
    }
  }

  if (ids.length === 0) {
    const text = line.rawText.trim();
    if (text) {
      const byText = await searchProductIds({
        query: text,
        isActive: true,
        take: CANDIDATES_PER_LINE,
        cacheProfile: "admin",
      });
      if (byText.ids.length > 0) {
        ids = byText.ids;
        confidence = "near";
      }
    }
  }

  const candidates = await loadProductOptions(ids);

  return {
    rawText: line.rawText,
    partCode: line.partCode,
    qty: line.qty ?? 0,
    unitCost: line.unitCost ?? 0,
    candidates,
    confidence: candidates.length > 0 ? confidence : "none",
  };
}

/** A line returned without catalog candidates (admin matches it manually). */
function unmatchedLine(line: PurchaseOcrLine): PurchaseOcrMatchedLine {
  return {
    rawText: line.rawText,
    partCode: line.partCode,
    qty: line.qty ?? 0,
    unitCost: line.unitCost ?? 0,
    candidates: [],
    confidence: "none",
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * Matches OCR lines in bounded batches (DB pool safety) within an overall time
 * budget (function-timeout safety). Each line also has its own timeout so one slow
 * embedding can't stall the batch. Lines past the budget come back unmatched.
 */
async function matchLinesBounded(
  ocrLines: PurchaseOcrLine[],
): Promise<PurchaseOcrMatchedLine[]> {
  const start = Date.now();
  const matched: PurchaseOcrMatchedLine[] = [];

  for (let i = 0; i < ocrLines.length; i += MATCH_CONCURRENCY) {
    const batch = ocrLines.slice(i, i + MATCH_CONCURRENCY);
    if (Date.now() - start > MATCH_TOTAL_BUDGET_MS) {
      matched.push(...batch.map(unmatchedLine));
      continue;
    }
    matched.push(
      ...(await Promise.all(
        batch.map((line) =>
          withTimeout(matchLine(line), MATCH_PER_LINE_TIMEOUT_MS, unmatchedLine(line)),
        ),
      )),
    );
  }
  return matched;
}

/**
 * Prepares one fetched file for Gemini. Images are downscaled + re-encoded with
 * sharp for clean, consistent OCR input; PDFs pass through untouched. Falls back
 * to the original bytes when sharp can't decode the image (e.g. HEIC).
 */
async function prepareForGemini(
  buffer: Buffer,
  mimeType: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (mimeType === "application/pdf") {
    return { buffer, mimeType };
  }
  try {
    const out = await sharp(buffer)
      .rotate() // honor EXIF orientation
      .resize({
        width: IMAGE_MAX_DIMENSION,
        height: IMAGE_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: IMAGE_JPEG_QUALITY })
      .toBuffer();
    return { buffer: out, mimeType: "image/jpeg" };
  } catch {
    return { buffer, mimeType };
  }
}

/**
 * Server Action #1: validates the chosen files and returns one signed upload URL
 * per file so the browser can upload directly to private storage — keeping the
 * bytes out of the Server Action body. Read-only (no business mutation).
 */
export async function requestPurchaseOcrUpload(
  files: RequestedOcrFile[],
): Promise<{ error: string } | { tickets: PurchaseOcrUploadTicket[] }> {
  const session = await requirePermission("purchases.create").catch(() => null);
  if (!session) return { error: "ไม่มีสิทธิ์ใช้งาน" };

  try {
    if (!Array.isArray(files) || files.length === 0) {
      return { error: "กรุณาแนบไฟล์อย่างน้อย 1 ไฟล์" };
    }
    if (files.length > PURCHASE_OCR_MAX_FILES) {
      return { error: `แนบไฟล์ได้ไม่เกิน ${PURCHASE_OCR_MAX_FILES} ไฟล์ต่อครั้ง` };
    }

    let total = 0;
    for (const file of files) {
      if (!isAcceptedPurchaseOcrMime(file.mimeType)) {
        return { error: "รองรับเฉพาะไฟล์รูปภาพหรือ PDF เท่านั้น" };
      }
      if (file.size <= 0 || file.size > PURCHASE_OCR_MAX_FILE_BYTES) {
        return { error: "ขนาดไฟล์ต้องไม่เกิน 15MB ต่อไฟล์" };
      }
      total += file.size;
    }
    if (total > PURCHASE_OCR_MAX_TOTAL_BYTES) {
      return { error: "ขนาดไฟล์รวมต้องไม่เกิน 20MB" };
    }

    const tickets = await createPurchaseOcrUploadTickets(files.map((file) => file.mimeType));
    if (!tickets) return { error: "ระบบจัดเก็บไฟล์ยังไม่พร้อมใช้งาน" };
    return { tickets };
  } catch {
    return { error: GENERIC_ERROR };
  }
}

/**
 * Server Action #2: fetches the uploaded files from storage, OCRs them with Gemini,
 * and matches each line to catalog products. Read-only assist — the actual save
 * still runs through `createPurchase`, so StockCard/MAVG/audit stay unchanged. Temp
 * files are deleted immediately in `finally`; the daily cron sweeps any orphans.
 */
export async function extractPurchaseInvoiceFromStorage(
  storedFiles: StoredOcrFile[],
): Promise<ExtractResult> {
  const session = await requirePermission("purchases.create").catch(() => null);
  if (!session) return { error: "ไม่มีสิทธิ์ใช้งาน" };

  const paths = Array.isArray(storedFiles) ? storedFiles.map((file) => file.path) : [];

  try {
    if (!storedFiles || storedFiles.length === 0) {
      return { error: "ไม่พบไฟล์ที่อัปโหลด" };
    }
    if (storedFiles.length > PURCHASE_OCR_MAX_FILES) {
      return { error: `แนบไฟล์ได้ไม่เกิน ${PURCHASE_OCR_MAX_FILES} ไฟล์ต่อครั้ง` };
    }

    const images: { mimeType: string; dataBase64: string }[] = [];
    let sendBytes = 0;
    for (const file of storedFiles) {
      const fetched = await fetchPurchaseOcrFile(file.path);
      if (!fetched) continue;
      if (fetched.bytes > PURCHASE_OCR_MAX_FILE_BYTES) {
        return { error: "ขนาดไฟล์ต้องไม่เกิน 15MB ต่อไฟล์" };
      }

      const mime =
        fetched.contentType !== "application/octet-stream" ? fetched.contentType : file.mimeType;
      if (!isAcceptedPurchaseOcrMime(mime)) {
        return { error: "รองรับเฉพาะไฟล์รูปภาพหรือ PDF เท่านั้น" };
      }

      const prepared = await prepareForGemini(fetched.buffer, mime);
      sendBytes += prepared.buffer.byteLength;
      if (sendBytes > GEMINI_SEND_BUDGET_BYTES) {
        return {
          error: "ไฟล์รวมกันใหญ่เกินไปสำหรับการอ่าน กรุณาลดจำนวนไฟล์หรือใช้ PDF ที่เล็กกว่า",
        };
      }
      images.push({ mimeType: prepared.mimeType, dataBase64: prepared.buffer.toString("base64") });
    }

    if (images.length === 0) {
      return { error: "อ่านไฟล์ที่อัปโหลดไม่ได้ กรุณาลองใหม่" };
    }

    const ocr = await runPurchaseInvoiceOcr(images);
    if (ocr.status === "no_keys") {
      return { error: "ระบบ AI ยังไม่พร้อมใช้งาน กรุณากรอกเอง" };
    }
    if (ocr.status === "ai_error") {
      // Server log keeps the real cause (see runPurchaseInvoiceOcr); message stays generic.
      return { error: "อ่านไฟล์ด้วย AI ไม่สำเร็จ กรุณาลองใหม่ หรือลดจำนวน/ขนาดไฟล์" };
    }
    if (ocr.result.lines.length === 0) {
      console.error("[purchase-ocr] zero lines", { rawLength: ocr.rawText.length });
      return { error: "อ่านไฟล์ได้แต่ไม่พบรายการสินค้า กรุณากรอกเอง" };
    }

    const lines = await matchLinesBounded(ocr.result.lines);

    // Read-only assist — structured log only (no AuditLog row; the business audit
    // is written by createPurchase when the admin saves).
    console.info("[purchase-ocr] scan", {
      actorId: session.user?.id ?? null,
      files: storedFiles.length,
      lines: lines.length,
      supplier: ocr.result.supplierName,
    });

    return {
      data: {
        supplierName: ocr.result.supplierName,
        referenceNo: ocr.result.referenceNo,
        invoiceDate: ocr.result.invoiceDate,
        lines,
      },
    };
  } catch (error) {
    console.error(
      "[purchase-ocr] extract failed",
      error instanceof Error ? error.message : String(error),
    );
    return { error: GENERIC_ERROR };
  } finally {
    // Delete temp immediately (happy + error paths). Cron sweeps anything missed.
    await deletePurchaseOcrFiles(paths);
  }
}
