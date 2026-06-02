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

  const [salesGrouped, saleRefs, stockMappings, failedSyncJobs, reviewOrders] = await Promise.all([
    db.sale.groupBy({
      by: ["channel"],
      where: saleWhere,
      _sum: { netAmount: true },
      _count: { _all: true },
    }),
    db.sale.findMany({
      where: saleWhere,
      select: { id: true, channel: true },
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
        importStatus: { in: ["FAILED", "NEEDS_SKU_MAPPING", "NEEDS_LOT_SELECTION", "CANCELLED_REVIEW"] },
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

  const saleIdsByChannel = new Map<SaleChannel, string[]>();
  for (const sale of saleRefs) {
    const ids = saleIdsByChannel.get(sale.channel) ?? [];
    ids.push(sale.id);
    saleIdsByChannel.set(sale.channel, ids);
  }

  await Promise.all(
    Array.from(saleIdsByChannel.entries()).map(async ([channel, sourceIds]) => {
      if (sourceIds.length === 0) return;
      const profit = await db.factProfit.aggregate({
        where: {
          isActive: true,
          sourceType: ProfitSourceType.SALE,
          sourceId: { in: sourceIds },
          businessDate: { gte: input.from, lte: input.to },
        },
        _sum: { grossProfit: true },
      });
      const metric = metrics.get(channel) ?? emptyMetric(channel);
      metric.grossProfit = asNumber(profit._sum.grossProfit);
      metrics.set(channel, metric);
    }),
  );

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
