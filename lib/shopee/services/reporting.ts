import { db } from "@/lib/db";
import { ProfitSourceType, SaleChannel, ShopeeSyncMode } from "@/lib/generated/prisma";
import { resolveShopeeStockStatus } from "@/lib/shopee/stock-utils";

export type ShopeeChannelMetric = {
  channel: SaleChannel;
  salesAmount: number;
  grossProfit: number;
  orderCount: number;
};

export type ShopeeStockRiskMetric = {
  totalMappings: number;
  pushEnabled: number;
  needsPush: number;
  failed: number;
};

export type ShopeeReportingSummary = {
  store: ShopeeChannelMetric;
  shopee: ShopeeChannelMetric;
  stockRisk: ShopeeStockRiskMetric;
  failedSyncJobs: number;
  reviewOrders: number;
};

function emptyMetric(channel: SaleChannel): ShopeeChannelMetric {
  return { channel, salesAmount: 0, grossProfit: 0, orderCount: 0 };
}

function asNumber(value: unknown): number {
  return Number(value ?? 0);
}

export async function getShopeeReportingSummary(input: {
  from: Date;
  to: Date;
}): Promise<ShopeeReportingSummary> {
  const saleWhere = {
    status: "ACTIVE" as const,
    saleDate: { gte: input.from, lte: input.to },
  };

  const [salesGrouped, profitGrouped, stockMappings, failedSyncJobs, reviewOrders] = await Promise.all([
    db.sale.groupBy({
      by: ["channel"],
      where: saleWhere,
      _sum: { netAmount: true },
      _count: { _all: true },
    }),
    // Gross profit split by channel via the denormalized FactProfit.channel
    // (indexed) — no longer loads every sale id + a huge `sourceId IN (...)`.
    db.factProfit.groupBy({
      by: ["channel"],
      where: {
        isActive: true,
        sourceType: ProfitSourceType.SALE,
        businessDate: { gte: input.from, lte: input.to },
      },
      _sum: { grossProfit: true },
    }),
    db.shopeeProductMapping.findMany({
      where: { isActive: true },
      select: {
        syncMode: true,
        stockBuffer: true,
        lastPushedStock: true,
        lastError: true,
        shop: { select: { stockBuffer: true } },
        product: { select: { stock: true } },
      },
    }),
    db.shopeeSyncJob.count({
      where: { status: "FAILED", createdAt: { gte: input.from, lte: input.to } },
    }),
    db.shopeeOrderImport.count({
      where: {
        OR: [
          { importStatus: { in: ["FAILED", "NEEDS_SKU_MAPPING", "NEEDS_LOT_SELECTION", "CANCELLED_REVIEW"] } },
          { returnReviewRequired: true },
        ],
      },
    }),
  ]);

  const metrics = new Map<SaleChannel, ShopeeChannelMetric>([
    [SaleChannel.STORE, emptyMetric(SaleChannel.STORE)],
    [SaleChannel.SHOPEE, emptyMetric(SaleChannel.SHOPEE)],
  ]);

  for (const row of salesGrouped) {
    metrics.set(row.channel, {
      channel: row.channel,
      salesAmount: asNumber(row._sum.netAmount),
      grossProfit: 0,
      orderCount: row._count._all,
    });
  }

  for (const row of profitGrouped) {
    if (!row.channel) continue; // facts not yet tagged (pre-backfill) — skip
    const metric = metrics.get(row.channel) ?? emptyMetric(row.channel);
    metric.grossProfit = asNumber(row._sum.grossProfit);
    metrics.set(row.channel, metric);
  }

  const stockRisk = stockMappings.reduce<ShopeeStockRiskMetric>(
    (acc, mapping) => {
      const targetStock = Math.max(0, mapping.product.stock - (mapping.stockBuffer ?? mapping.shop.stockBuffer));
      const status = resolveShopeeStockStatus({
        syncMode: mapping.syncMode,
        targetStock,
        lastPushedStock: mapping.lastPushedStock,
        lastError: mapping.lastError,
      });

      acc.totalMappings += 1;
      if (mapping.syncMode === ShopeeSyncMode.PUSH_INTERNAL_TO_SHOPEE) acc.pushEnabled += 1;
      if (status === "NEEDS_PUSH" || status === "NOT_PUSHED") acc.needsPush += 1;
      if (status === "PUSH_FAILED") acc.failed += 1;
      return acc;
    },
    { totalMappings: 0, pushEnabled: 0, needsPush: 0, failed: 0 },
  );

  return {
    store: metrics.get(SaleChannel.STORE) ?? emptyMetric(SaleChannel.STORE),
    shopee: metrics.get(SaleChannel.SHOPEE) ?? emptyMetric(SaleChannel.SHOPEE),
    stockRisk,
    failedSyncJobs,
    reviewOrders,
  };
}
