import { db } from "@/lib/db";
import { ProfitSourceType, SaleChannel } from "@/lib/generated/prisma";

export type ShopeeChannelMetric = {
  channel: SaleChannel;
  /** ยอดขายของใบขาย (ยังไม่หักลดหนี้) — สรุปรายวันทาง LINE ใช้ค่านี้ */
  salesAmount: number;
  /** กำไรขั้นต้นของใบขาย (ยังไม่หักลดหนี้) — สรุปรายวันทาง LINE ใช้ค่านี้ */
  grossProfit: number;
  orderCount: number;
  /** ยอดลดหนี้/คืนสินค้าตามวันที่ใบลดหนี้ (บวก = ยอดที่ต้องหักออก) */
  returnAmount: number;
  /** กำไรขั้นต้นที่ลดลงจากลดหนี้/คืนสินค้า (บวก = ยอดที่ต้องหักออก) */
  returnGrossProfit: number;
  /** ค่าธรรมเนียมจากรอบกระทบยอดที่ปันลงบิลในช่วงนี้ (บวก = ยอดที่ต้องหักออก) */
  marketplaceFeeAmount: number;
  /** รายรับพิเศษที่ marketplace จ่ายเพิ่มในรอบกระทบยอด ที่ปันลงบิลในช่วงนี้ */
  marketplaceIncomeAmount: number;
};

export type ShopeeReportingSummary = {
  store: ShopeeChannelMetric;
  shopee: ShopeeChannelMetric;
  lazada: ShopeeChannelMetric;
};

/** sourceSubtype ของ fact ค่าธรรมเนียม / รายรับพิเศษจากรอบกระทบยอด (lib/profit-fact.ts) */
const MARKETPLACE_FEE_SUBTYPE = "MARKETPLACE_FEE";
const MARKETPLACE_INCOME_SUBTYPE = "MARKETPLACE_INCOME";

function emptyMetric(channel: SaleChannel): ShopeeChannelMetric {
  return {
    channel,
    salesAmount: 0,
    grossProfit: 0,
    orderCount: 0,
    returnAmount: 0,
    returnGrossProfit: 0,
    marketplaceFeeAmount: 0,
    marketplaceIncomeAmount: 0,
  };
}

function asNumber(value: unknown): number {
  return Number(value ?? 0);
}

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

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
    // Profit split by channel via the denormalized FactProfit.channel (indexed). One
    // query covers sale profit, credit notes, and settlement fee / income shares — the
    // fee facts are dated on their sale's date (lib/marketplace/settlement-fee-dating.ts).
    db.factProfit.groupBy({
      by: ["channel", "sourceType"],
      where: {
        isActive: true,
        businessDate: { gte: input.from, lte: input.to },
        OR: [
          { sourceType: { in: [ProfitSourceType.SALE, ProfitSourceType.SALE_RETURN] } },
          { sourceType: ProfitSourceType.EXPENSE, sourceSubtype: MARKETPLACE_FEE_SUBTYPE },
          { sourceType: ProfitSourceType.OTHER_INCOME, sourceSubtype: MARKETPLACE_INCOME_SUBTYPE },
        ],
      },
      _sum: { grossProfit: true, salesAmountIncVat: true, expenseAmount: true, netProfitAmount: true },
    }),
  ]);

  const metrics = new Map<SaleChannel, ShopeeChannelMetric>([
    [SaleChannel.STORE, emptyMetric(SaleChannel.STORE)],
    [SaleChannel.SHOPEE, emptyMetric(SaleChannel.SHOPEE)],
    [SaleChannel.LAZADA, emptyMetric(SaleChannel.LAZADA)],
  ]);

  for (const row of salesGrouped) {
    const metric = metrics.get(row.channel) ?? emptyMetric(row.channel);
    metric.salesAmount = asNumber(row._sum.netAmount);
    metric.orderCount = row._count._all;
    metrics.set(row.channel, metric);
  }

  for (const row of profitGrouped) {
    if (!row.channel) continue; // facts not yet tagged (pre-backfill) — skip
    const metric = metrics.get(row.channel) ?? emptyMetric(row.channel);
    switch (row.sourceType) {
      case ProfitSourceType.SALE:
        metric.grossProfit = asNumber(row._sum.grossProfit);
        break;
      case ProfitSourceType.SALE_RETURN:
        // SALE_RETURN facts carry negative amounts; store them as positive deductions.
        metric.returnAmount = roundMoney(-asNumber(row._sum.salesAmountIncVat));
        metric.returnGrossProfit = roundMoney(-asNumber(row._sum.grossProfit));
        break;
      case ProfitSourceType.EXPENSE:
        metric.marketplaceFeeAmount = asNumber(row._sum.expenseAmount);
        break;
      case ProfitSourceType.OTHER_INCOME:
        metric.marketplaceIncomeAmount = asNumber(row._sum.netProfitAmount);
        break;
    }
    metrics.set(row.channel, metric);
  }

  return {
    store: metrics.get(SaleChannel.STORE) ?? emptyMetric(SaleChannel.STORE),
    shopee: metrics.get(SaleChannel.SHOPEE) ?? emptyMetric(SaleChannel.SHOPEE),
    lazada: metrics.get(SaleChannel.LAZADA) ?? emptyMetric(SaleChannel.LAZADA),
  };
}

/**
 * ยอดที่การ์ด dashboard ไล่หักจาก Gross profit ของใบขาย: ลบคืนสินค้า/ลดหนี้ แล้วลบค่าธรรมเนียม
 * ที่กระทบยอดแล้ว
 */
export type ChannelNetFigures = {
  hasReturn: boolean;
  /** Gross profit หลังหักคืนสินค้า/ลดหนี้ */
  profitAfterReturn: number;
  /** ค่าธรรมเนียมสุทธิ = ค่าธรรมเนียม − รายรับพิเศษ (บวก = หักออก) */
  netMarketplaceFee: number;
  profitAfterFee: number;
};

export function computeChannelNetFigures(metric: ShopeeChannelMetric): ChannelNetFigures {
  const profitAfterReturn = roundMoney(metric.grossProfit - metric.returnGrossProfit);
  const netMarketplaceFee = roundMoney(metric.marketplaceFeeAmount - metric.marketplaceIncomeAmount);
  return {
    hasReturn: metric.returnAmount !== 0 || metric.returnGrossProfit !== 0,
    profitAfterReturn,
    netMarketplaceFee,
    profitAfterFee: roundMoney(profitAfterReturn - netMarketplaceFee),
  };
}
