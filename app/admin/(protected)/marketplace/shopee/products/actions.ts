"use server";

import { revalidatePath } from "next/cache";

import {
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db } from "@/lib/db";
import { AuditAction, ShopeeSyncMode } from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";
import {
  createShopeeMapping,
  deleteShopeeMapping,
  suggestAutoMappings,
  type AutoMatchSuggestion,
} from "@/lib/shopee/services/mapping";
import { fetchShopeeItems, type ShopeeItemSummary } from "@/lib/shopee/services/products";

const PRODUCTS_PATH = "/admin/marketplace/shopee/products";
const PRODUCT_SEARCH_LIMIT = 50;

function parseSyncMode(value: FormDataEntryValue | null): ShopeeSyncMode {
  const raw = String(value ?? "");
  return raw === "PUSH_INTERNAL_TO_SHOPEE" || raw === "DISABLED"
    ? (raw as ShopeeSyncMode)
    : ShopeeSyncMode.MONITOR_ONLY;
}

export type MappingActionResult = { ok: true } | { ok: false; error: string };
export type ProductSearchOption = { id: string; label: string; sublabel?: string };

export async function searchProductOptionsAction(query: string): Promise<ProductSearchOption[]> {
  try {
    await requirePermission("marketplace.view");
  } catch {
    return [];
  }

  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const products = await db.product.findMany({
    where: {
      isActive: true,
      OR: [
        { code: { contains: trimmed, mode: "insensitive" } },
        { name: { contains: trimmed, mode: "insensitive" } },
      ],
    },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
    take: PRODUCT_SEARCH_LIMIT,
  });

  return products.map((product) => ({
    id: product.id,
    label: product.name,
    sublabel: product.code,
  }));
}

export async function createMappingAction(formData: FormData): Promise<MappingActionResult> {
  let session;
  try {
    session = await requirePermission("marketplace.manage");
  } catch {
    return { ok: false, error: "ไม่มีสิทธิ์จัดการการ map" };
  }

  const result = await createShopeeMapping({
    shopRecordId: String(formData.get("shopRecordId") ?? ""),
    productId: String(formData.get("productId") ?? ""),
    itemId: String(formData.get("itemId") ?? ""),
    modelId: String(formData.get("modelId") ?? "0"),
    sellerSku: String(formData.get("sellerSku") ?? "") || null,
    syncMode: parseSyncMode(formData.get("syncMode")),
  });

  if ("error" in result) return { ok: false, error: result.error };

  await safeWriteAuditLog({
    ...getAuditActorFromSession(session),
    ...(await getRequestContext()),
    action: AuditAction.CREATE,
    entityType: "ShopeeProductMapping",
    entityId: result.id,
    meta: {
      productId: String(formData.get("productId") ?? ""),
      itemId: String(formData.get("itemId") ?? ""),
      modelId: String(formData.get("modelId") ?? "0"),
    },
  });

  revalidatePath(PRODUCTS_PATH);
  return { ok: true };
}

export async function deleteMappingAction(formData: FormData): Promise<MappingActionResult> {
  let session;
  try {
    session = await requirePermission("marketplace.manage");
  } catch {
    return { ok: false, error: "ไม่มีสิทธิ์จัดการการ map" };
  }

  const id = String(formData.get("id") ?? "");
  const removed = await deleteShopeeMapping(id);
  if (!removed) return { ok: false, error: "ไม่พบรายการ map" };

  await safeWriteAuditLog({
    ...getAuditActorFromSession(session),
    ...(await getRequestContext()),
    action: AuditAction.DELETE,
    entityType: "ShopeeProductMapping",
    entityId: id,
    meta: { itemId: removed.itemId },
  });

  revalidatePath(PRODUCTS_PATH);
  return { ok: true };
}

export type PullItemsResult =
  | { ok: true; itemCount: number; suggestions: AutoMatchSuggestion[]; unmappedCount: number }
  | { ok: false; error: string };

function collectShopeeSkus(items: ShopeeItemSummary[]): string[] {
  const skus = new Set<string>();
  for (const item of items) {
    if (item.sku?.trim()) skus.add(item.sku.trim());
    for (const model of item.models) {
      if (model.sku?.trim()) skus.add(model.sku.trim());
    }
  }
  return Array.from(skus);
}

export async function pullShopeeItemsAction(shopRecordId: string): Promise<PullItemsResult> {
  try {
    await requirePermission("marketplace.view");
  } catch {
    return { ok: false, error: "ไม่มีสิทธิ์ดูข้อมูล" };
  }

  try {
    const [items, existing] = await Promise.all([
      fetchShopeeItems(shopRecordId),
      db.shopeeProductMapping.findMany({
        where: { shopRecordId },
        select: { itemId: true, modelId: true },
      }),
    ]);
    const skus = collectShopeeSkus(items);
    const products = skus.length
      ? await db.product.findMany({
          where: { isActive: true, code: { in: skus } },
          select: { id: true, code: true, name: true },
        })
      : [];

    const existingKeys = new Set(existing.map((e) => `${e.itemId}::${e.modelId}`));
    const suggestions = suggestAutoMappings(items, products, existing);
    const unmappedCount = items.filter((item) => {
      if (item.hasModel && item.models.length > 0) {
        return item.models.some((model) => !existingKeys.has(`${item.itemId}::${model.modelId}`));
      }
      return !existingKeys.has(`${item.itemId}::0`);
    }).length;

    return { ok: true, itemCount: items.length, suggestions, unmappedCount };
  } catch (error) {
    console.error("[shopee] pull items failed:", error instanceof Error ? error.message : "unknown");
    return { ok: false, error: "ดึงสินค้าจาก Shopee ไม่สำเร็จ — ตรวจสอบการเชื่อมต่อร้าน" };
  }
}

export async function applySuggestionsAction(formData: FormData): Promise<MappingActionResult> {
  let session;
  try {
    session = await requirePermission("marketplace.manage");
  } catch {
    return { ok: false, error: "ไม่มีสิทธิ์จัดการการ map" };
  }

  const shopRecordId = String(formData.get("shopRecordId") ?? "");
  const raw = String(formData.get("suggestions") ?? "[]");
  let selected: AutoMatchSuggestion[];
  try {
    selected = JSON.parse(raw) as AutoMatchSuggestion[];
  } catch {
    return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  }
  if (!Array.isArray(selected) || selected.length === 0) {
    return { ok: false, error: "ยังไม่ได้เลือกรายการ" };
  }

  let created = 0;
  for (const suggestion of selected) {
    const result = await createShopeeMapping({
      shopRecordId,
      productId: suggestion.productId,
      itemId: suggestion.itemId,
      modelId: suggestion.modelId,
      sellerSku: suggestion.sku,
    });
    if ("id" in result) created += 1;
  }

  await safeWriteAuditLog({
    ...getAuditActorFromSession(session),
    ...(await getRequestContext()),
    action: AuditAction.CREATE,
    entityType: "ShopeeProductMapping",
    meta: { event: "AUTO_MAP_APPLY", requested: selected.length, created },
  });

  revalidatePath(PRODUCTS_PATH);
  return { ok: true };
}
