import { db } from "@/lib/db";
import { Prisma, ShopeeSyncMode } from "@/lib/generated/prisma";
import type { ShopeeItemSummary } from "@/lib/shopee/services/products";

/**
 * Shopee ↔ internal product mapping (Phase D).
 * DB CRUD + a PURE auto-match suggester (Shopee seller SKU == internal code).
 * Permission checks + audit live in the Server Actions that call these.
 */

export type ShopeeMappingRow = {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  itemId: string;
  modelId: string;
  sellerSku: string | null;
  syncMode: ShopeeSyncMode;
  isActive: boolean;
};

export async function listShopeeMappings(shopRecordId: string): Promise<ShopeeMappingRow[]> {
  const rows = await db.shopeeProductMapping.findMany({
    where: { shopRecordId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      productId: true,
      itemId: true,
      modelId: true,
      sellerSku: true,
      syncMode: true,
      isActive: true,
      product: { select: { code: true, name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    productId: row.productId,
    productCode: row.product.code,
    productName: row.product.name,
    itemId: row.itemId,
    modelId: row.modelId,
    sellerSku: row.sellerSku,
    syncMode: row.syncMode,
    isActive: row.isActive,
  }));
}

export type CreateMappingInput = {
  shopRecordId: string;
  productId: string;
  productUnitId?: string | null;
  itemId: string;
  modelId?: string;
  sellerSku?: string | null;
  syncMode?: ShopeeSyncMode;
};

export type CreateMappingResult = { id: string } | { error: string };

export async function createShopeeMapping(input: CreateMappingInput): Promise<CreateMappingResult> {
  const itemId = input.itemId.trim();
  const modelId = (input.modelId ?? "0").trim() || "0";
  if (!itemId) return { error: "กรุณาระบุ Shopee item id" };

  const product = await db.product.findUnique({
    where: { id: input.productId },
    select: { id: true },
  });
  if (!product) return { error: "ไม่พบสินค้าที่เลือก" };

  try {
    const created = await db.shopeeProductMapping.create({
      data: {
        shopRecordId: input.shopRecordId,
        productId: input.productId,
        productUnitId: input.productUnitId ?? null,
        itemId,
        modelId,
        sellerSku: input.sellerSku?.trim() || null,
        syncMode: input.syncMode ?? ShopeeSyncMode.MONITOR_ONLY,
      },
      select: { id: true },
    });
    return { id: created.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "Shopee item/model นี้ถูก map ไว้แล้ว" };
    }
    return { error: "บันทึกการ map ไม่สำเร็จ" };
  }
}

export async function deleteShopeeMapping(id: string): Promise<{ shopRecordId: string; itemId: string } | null> {
  const existing = await db.shopeeProductMapping.findUnique({
    where: { id },
    select: { id: true, shopRecordId: true, itemId: true },
  });
  if (!existing) return null;
  await db.shopeeProductMapping.delete({ where: { id } });
  return { shopRecordId: existing.shopRecordId, itemId: existing.itemId };
}

export type AutoMatchSuggestion = {
  itemId: string;
  modelId: string;
  sku: string;
  productId: string;
  productCode: string;
  productName: string;
};

type ProductLite = { id: string; code: string; name: string };

/**
 * Suggests mappings where a Shopee seller SKU equals an internal product code
 * (case-insensitive). Already-mapped item/model pairs are skipped. PURE — no I/O.
 */
export function suggestAutoMappings(
  items: ShopeeItemSummary[],
  products: ProductLite[],
  existing: ReadonlyArray<{ itemId: string; modelId: string }>,
): AutoMatchSuggestion[] {
  const byCode = new Map<string, ProductLite>();
  for (const product of products) {
    byCode.set(product.code.trim().toLowerCase(), product);
  }
  const existingKeys = new Set(existing.map((e) => `${e.itemId}::${e.modelId}`));

  const suggestions: AutoMatchSuggestion[] = [];
  const pushIfMatch = (itemId: string, modelId: string, sku: string | null) => {
    if (!sku) return;
    const product = byCode.get(sku.trim().toLowerCase());
    if (!product) return;
    if (existingKeys.has(`${itemId}::${modelId}`)) return;
    suggestions.push({
      itemId,
      modelId,
      sku,
      productId: product.id,
      productCode: product.code,
      productName: product.name,
    });
  };

  for (const item of items) {
    if (item.hasModel && item.models.length > 0) {
      for (const model of item.models) {
        pushIfMatch(item.itemId, model.modelId, model.sku);
      }
    } else {
      pushIfMatch(item.itemId, "0", item.sku);
    }
  }

  return suggestions;
}
