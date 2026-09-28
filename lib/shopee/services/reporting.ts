import { db } from "@/lib/db";
import { ProfitSourceType, SaleChannel } from "@/lib/generated/prisma";

export type ShopeeChannelMetric = {
  channel: SaleChannel;
  salesAmount: number;
  grossProfit: number;
  orderCount: number;
};

export type ShopeeReportingSummary = {
  store: ShopeeChannelMetric;
  shopee: ShopeeChannelMetric;
  lazada: ShopeeChannelMetric;
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

  const [salesGrouped, profitGrouped] = await Promise.all([
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
  ]);

  const metrics = new Map<SaleChannel, ShopeeChannelMetric>([
    [SaleChannel.STORE, emptyMetric(SaleChannel.STORE)],
    [SaleChannel.SHOPEE, emptyMetric(SaleChannel.SHOPEE)],
    [SaleChannel.LAZADA, emptyMetric(SaleChannel.LAZADA)],
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

  return {
    store: metrics.get(SaleChannel.STORE) ?? emptyMetric(SaleChannel.STORE),
    shopee: metrics.get(SaleChannel.SHOPEE) ?? emptyMetric(SaleChannel.SHOPEE),
    lazada: metrics.get(SaleChannel.LAZADA) ?? emptyMetric(SaleChannel.LAZADA),
  };
}
