import { db } from "@/lib/db";
import { ShopeeSyncMode } from "@/lib/generated/prisma";
import {
  calculateShopeeTargetStock,
  resolveShopeeStockStatus,
  type ShopeeStockReconciliationStatus,
} from "@/lib/shopee/stock-utils";

export type { ShopeeStockReconciliationStatus } from "@/lib/shopee/stock-utils";

/**
 * Phase G stock sync foundation.
 *
 * This module is intentionally conservative: it computes the stock value the
 * internal system would send to Shopee, but it does not call Shopee's stock API
 * until the live endpoint payload is verified with real credentials.
 */

export type ShopeeStockReconciliationRow = {
  mappingId: string;
  shopRecordId: string;
  productId: string;
  productCode: string;
  productName: string;
  itemId: string;
  modelId: string;
  sellerSku: string | null;
  syncMode: ShopeeSyncMode;
  internalStock: number;
  effectiveBuffer: number;
  targetStock: number;
  lastPushedStock: number | null;
  lastPushedAt: Date | null;
  lastError: string | null;
  status: ShopeeStockReconciliationStatus;
};

export type ShopeeStockSummary = {
  total: number;
  pushEnabled: number;
  needsPush: number;
  failed: number;
};

export type ShopeeStockReconciliation = {
  rows: ShopeeStockReconciliationRow[];
  summary: ShopeeStockSummary;
};

export async function listShopeeStockReconciliation(shopRecordId: string): Promise<ShopeeStockReconciliation> {
  const rows = await db.shopeeProductMapping.findMany({
    where: { shopRecordId, isActive: true },
    orderBy: [{ syncMode: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      shopRecordId: true,
      productId: true,
      itemId: true,
      modelId: true,
      sellerSku: true,
      syncMode: true,
      stockBuffer: true,
      lastPushedStock: true,
      lastPushedAt: true,
      lastError: true,
      shop: { select: { stockBuffer: true } },
      product: { select: { code: true, name: true, stock: true } },
    },
  });

  const mappedRows = rows.map((row): ShopeeStockReconciliationRow => {
    const effectiveBuffer = row.stockBuffer ?? row.shop.stockBuffer;
    const targetStock = calculateShopeeTargetStock(row.product.stock, effectiveBuffer);
    const status = resolveShopeeStockStatus({
      syncMode: row.syncMode,
      targetStock,
      lastPushedStock: row.lastPushedStock,
      lastError: row.lastError,
    });

    return {
      mappingId: row.id,
      shopRecordId: row.shopRecordId,
      productId: row.productId,
      productCode: row.product.code,
      productName: row.product.name,
      itemId: row.itemId,
      modelId: row.modelId,
      sellerSku: row.sellerSku,
      syncMode: row.syncMode,
      internalStock: row.product.stock,
      effectiveBuffer,
      targetStock,
      lastPushedStock: row.lastPushedStock,
      lastPushedAt: row.lastPushedAt,
      lastError: row.lastError,
      status,
    };
  });

  const summary = mappedRows.reduce<ShopeeStockSummary>(
    (acc, row) => {
      acc.total += 1;
      if (row.syncMode === ShopeeSyncMode.PUSH_INTERNAL_TO_SHOPEE) acc.pushEnabled += 1;
      if (row.status === "NEEDS_PUSH" || row.status === "NOT_PUSHED") acc.needsPush += 1;
      if (row.status === "PUSH_FAILED") acc.failed += 1;
      return acc;
    },
    { total: 0, pushEnabled: 0, needsPush: 0, failed: 0 },
  );

  return { rows: mappedRows, summary };
}
