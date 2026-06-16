"use server";

import { db } from "@/lib/db";
import { isInventoryTracked } from "@/lib/inventory-tracking";
import { searchProductIds } from "@/lib/product-search";
import { requirePermission } from "@/lib/require-auth";
import { runPurchaseInvoiceOcr } from "@/lib/purchase-invoice-ocr";
import {
  type PurchaseOcrExtraction,
  type PurchaseOcrLine,
  type PurchaseOcrMatchConfidence,
  type PurchaseOcrMatchedLine,
} from "@/lib/purchase-invoice-ocr-types";
import type { PurchaseProductOption } from "./purchase-form-data";

const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB per image
const CANDIDATES_PER_LINE = 3;

const GENERIC_ERROR = "เกิดข้อผิดพลาดในการอ่านรูป กรุณาลองใหม่";

type ExtractResult = { error: string } | { data: PurchaseOcrExtraction };

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

/**
 * Server Action: reads supplier-invoice images, OCRs them with Gemini, and matches
 * each line to catalog products. Read-only (no DB mutation, no audit) — it only
 * pre-fills the purchase form draft. The actual write still runs through
 * `createPurchase`, which keeps StockCard/MAVG/audit behaviour unchanged.
 */
export async function extractPurchaseInvoiceFromImages(
  formData: FormData,
): Promise<ExtractResult> {
  const session = await requirePermission("purchases.create").catch(() => null);
  if (!session) {
    return { error: "ไม่มีสิทธิ์ใช้งาน" };
  }

  try {
    const files = formData
      .getAll("images")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    if (files.length === 0) {
      return { error: "กรุณาแนบรูปใบส่งของอย่างน้อย 1 รูป" };
    }
    if (files.length > MAX_IMAGES) {
      return { error: `แนบรูปได้ไม่เกิน ${MAX_IMAGES} รูปต่อครั้ง` };
    }

    const images = [];
    for (const file of files) {
      const isAccepted = file.type.startsWith("image/") || file.type === "application/pdf";
      if (!isAccepted) {
        return { error: "รองรับเฉพาะไฟล์รูปภาพหรือ PDF เท่านั้น" };
      }
      if (file.size > MAX_IMAGE_BYTES) {
        return { error: "ขนาดไฟล์ต้องไม่เกิน 8MB ต่อไฟล์" };
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      images.push({ mimeType: file.type, dataBase64: buffer.toString("base64") });
    }

    const ocr = await runPurchaseInvoiceOcr(images);
    if (ocr.lines.length === 0) {
      return { error: "อ่านรายการสินค้าจากรูปไม่ได้ กรุณากรอกเอง" };
    }

    const lines = await Promise.all(ocr.lines.map(matchLine));

    return {
      data: {
        supplierName: ocr.supplierName,
        referenceNo: ocr.referenceNo,
        invoiceDate: ocr.invoiceDate,
        lines,
      },
    };
  } catch {
    return { error: GENERIC_ERROR };
  }
}
