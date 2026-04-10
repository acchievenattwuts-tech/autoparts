import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import { getBangkokDayKey } from "@/lib/storefront-visitor";

const DAY_MS = 24 * 60 * 60 * 1000;
const BANGKOK_TZ_OFFSET = "+07:00";
const BANGKOK_TIMEZONE = "Asia/Bangkok";

type MoneySection = {
  salesTotal: number;
  cashSales: number;
  creditSales: number;
  cashInFromSales: number;
  cashInFromReceipts: number;
  cashInTotal: number;
  cashChannelTotal: number;
  transferChannelTotal: number;
  arOutstanding: number;
  codOutstanding: number;
  apOutstanding: number;
  expensesToday: number;
  transfersToday: number;
};

type CountSection = {
  pendingDelivery: number;
  outForDelivery: number;
  deliveredToday: number;
  lowStockCount: number;
  outOfStockCount: number;
  expiringLotCount: number;
  expiredLotCount: number;
  openClaimCount: number;
  cancelledDocumentCount: number;
  stockAdjustmentCount: number;
};

export type LineDailySummary = {
  reportDayKey: string;
  reportDateLabel: string;
  shopName: string;
  range: {
    start: Date;
    end: Date;
  };
  money: MoneySection;
  counts: CountSection;
  message: string;
};

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

function isValidDayKey(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00${BANGKOK_TZ_OFFSET}`);
  return !Number.isNaN(parsed.getTime());
}

export function resolveBangkokDayKey(value?: string): string {
  return isValidDayKey(value) ? value : getBangkokDayKey();
}

function getBangkokDayRange(dayKey: string) {
  const start = new Date(`${dayKey}T00:00:00${BANGKOK_TZ_OFFSET}`);
  const end = new Date(start.getTime() + DAY_MS - 1);
  return { start, end };
}

function formatThaiDate(dayKey: string) {
  return new Date(`${dayKey}T00:00:00${BANGKOK_TZ_OFFSET}`).toLocaleDateString(
    "th-TH-u-ca-gregory",
    {
      timeZone: BANGKOK_TIMEZONE,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }
  );
}

function formatMoney(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCount(value: number) {
  return value.toLocaleString("th-TH");
}

async function getLotExpiryCounts(reportStart: Date, reportEnd: Date) {
  const threshold = new Date(reportEnd.getTime() + 30 * DAY_MS);

  const productLots = await db.productLot.findMany({
    where: {
      expDate: {
        not: null,
        lte: threshold,
      },
    },
    select: {
      productId: true,
      lotNo: true,
      expDate: true,
    },
  });

  if (productLots.length === 0) {
    return { expiringLotCount: 0, expiredLotCount: 0 };
  }

  const lotBalances = await db.lotBalance.findMany({
    where: {
      qtyOnHand: { gt: 0 },
      OR: productLots.map((lot) => ({
        productId: lot.productId,
        lotNo: lot.lotNo,
      })),
    },
    select: {
      productId: true,
      lotNo: true,
    },
  });

  const activeLotKeys = new Set(lotBalances.map((lot) => `${lot.productId}:${lot.lotNo}`));

  let expiringLotCount = 0;
  let expiredLotCount = 0;

  for (const lot of productLots) {
    if (!activeLotKeys.has(`${lot.productId}:${lot.lotNo}`)) {
      continue;
    }

    const expDate = lot.expDate!;
    if (expDate < reportStart) {
      expiredLotCount += 1;
    } else {
      expiringLotCount += 1;
    }
  }

  return { expiringLotCount, expiredLotCount };
}

function renderLineDailySummaryMessage(summary: {
  reportDateLabel: string;
  money: MoneySection;
  counts: CountSection;
}) {
  const { reportDateLabel, money, counts } = summary;

  return [
    `สรุปงานประจำวัน ${reportDateLabel}`,
    "",
    "ยอดขายวันนี้",
    `- ขายรวม ${formatMoney(money.salesTotal)} บาท`,
    `- ขายสด ${formatMoney(money.cashSales)} บาท`,
    `- ขายเชื่อ ${formatMoney(money.creditSales)} บาท`,
    "",
    "เงินรับเข้าวันนี้",
    `- จากการขายสด ${formatMoney(money.cashInFromSales)} บาท`,
    `- จากการรับชำระหนี้ ${formatMoney(money.cashInFromReceipts)} บาท`,
    `- รวมเงินเข้า ${formatMoney(money.cashInTotal)} บาท`,
    "",
    "แยกตามช่องทางรับเงิน",
    `- เงินสด ${formatMoney(money.cashChannelTotal)} บาท`,
    `- เงินโอน ${formatMoney(money.transferChannelTotal)} บาท`,
    "",
    "ยอดค้าง",
    `- ลูกหนี้ค้างรับ ${formatMoney(money.arOutstanding)} บาท`,
    `- COD ค้างรับเงิน ${formatMoney(money.codOutstanding)} บาท`,
    `- เจ้าหนี้ค้างจ่าย ${formatMoney(money.apOutstanding)} บาท`,
    "",
    "งานจัดส่ง",
    `- รอจัดส่ง ${formatCount(counts.pendingDelivery)} รายการ`,
    `- กำลังจัดส่ง ${formatCount(counts.outForDelivery)} รายการ`,
    `- ส่งสำเร็จวันนี้ ${formatCount(counts.deliveredToday)} รายการ`,
    "",
    "สต๊อก",
    `- ต่ำกว่าขั้นต่ำ ${formatCount(counts.lowStockCount)} รายการ`,
    `- ของหมด ${formatCount(counts.outOfStockCount)} รายการ`,
    `- lot ใกล้หมดอายุ ${formatCount(counts.expiringLotCount)} lot`,
    `- lot หมดอายุค้างสต๊อก ${formatCount(counts.expiredLotCount)} lot`,
    "",
    "เคลม/เอกสารผิดปกติ",
    `- เคลมค้างดำเนินการ ${formatCount(counts.openClaimCount)} รายการ`,
    `- เอกสารถูกยกเลิกวันนี้ ${formatCount(counts.cancelledDocumentCount)} รายการ`,
    `- ปรับสต๊อกวันนี้ ${formatCount(counts.stockAdjustmentCount)} เอกสาร`,
    "",
    "สรุปเพิ่มเติม",
    `- ค่าใช้จ่ายวันนี้ ${formatMoney(money.expensesToday)} บาท`,
    `- เงินโอนระหว่างบัญชีวันนี้ ${formatMoney(money.transfersToday)} บาท`,
  ].join("\n");
}

export async function buildLineDailySummary(dayKeyInput?: string): Promise<LineDailySummary> {
  const reportDayKey = resolveBangkokDayKey(dayKeyInput);
  const { start, end } = getBangkokDayRange(reportDayKey);
  const reportDateLabel = formatThaiDate(reportDayKey);

  const [
    siteConfig,
    salesTotalAgg,
    cashSalesAgg,
    creditSalesAgg,
    receiptTotalAgg,
    cashSaleCashAgg,
    cashSaleTransferAgg,
    receiptCashAgg,
    receiptTransferAgg,
    arOutstandingAgg,
    codOutstandingAgg,
    apOutstandingAgg,
    pendingDelivery,
    outForDelivery,
    deliveredToday,
    lowStockCount,
    outOfStockCount,
    openClaimCount,
    adjustmentCount,
    expensesTodayAgg,
    transfersTodayAgg,
    cancelledCounts,
    lotCounts,
  ] = await Promise.all([
    getSiteConfig(),
    db.sale.aggregate({
      _sum: { netAmount: true },
      where: {
        status: "ACTIVE",
        saleDate: { gte: start, lte: end },
      },
    }),
    db.sale.aggregate({
      _sum: { netAmount: true },
      where: {
        status: "ACTIVE",
        paymentType: "CASH_SALE",
        saleDate: { gte: start, lte: end },
      },
    }),
    db.sale.aggregate({
      _sum: { netAmount: true },
      where: {
        status: "ACTIVE",
        paymentType: "CREDIT_SALE",
        saleDate: { gte: start, lte: end },
      },
    }),
    db.receipt.aggregate({
      _sum: { totalAmount: true },
      where: {
        status: "ACTIVE",
        receiptDate: { gte: start, lte: end },
      },
    }),
    db.sale.aggregate({
      _sum: { netAmount: true },
      where: {
        status: "ACTIVE",
        paymentType: "CASH_SALE",
        paymentMethod: "CASH",
        saleDate: { gte: start, lte: end },
      },
    }),
    db.sale.aggregate({
      _sum: { netAmount: true },
      where: {
        status: "ACTIVE",
        paymentType: "CASH_SALE",
        paymentMethod: "TRANSFER",
        saleDate: { gte: start, lte: end },
      },
    }),
    db.receipt.aggregate({
      _sum: { totalAmount: true },
      where: {
        status: "ACTIVE",
        paymentMethod: "CASH",
        receiptDate: { gte: start, lte: end },
      },
    }),
    db.receipt.aggregate({
      _sum: { totalAmount: true },
      where: {
        status: "ACTIVE",
        paymentMethod: "TRANSFER",
        receiptDate: { gte: start, lte: end },
      },
    }),
    db.sale.aggregate({
      _sum: { amountRemain: true },
      where: {
        status: "ACTIVE",
        paymentType: "CREDIT_SALE",
        fulfillmentType: "PICKUP",
      },
    }),
    db.sale.aggregate({
      _sum: { amountRemain: true },
      where: {
        status: "ACTIVE",
        paymentType: "CREDIT_SALE",
        fulfillmentType: "DELIVERY",
        shippingStatus: { not: "DELIVERED" },
      },
    }),
    db.purchase.aggregate({
      _sum: { amountRemain: true },
      where: {
        status: "ACTIVE",
        purchaseType: "CREDIT_PURCHASE",
        amountRemain: { gt: 0 },
      },
    }),
    db.sale.count({
      where: {
        status: "ACTIVE",
        fulfillmentType: "DELIVERY",
        shippingStatus: "PENDING",
      },
    }),
    db.sale.count({
      where: {
        status: "ACTIVE",
        fulfillmentType: "DELIVERY",
        shippingStatus: "OUT_FOR_DELIVERY",
      },
    }),
    db.sale.count({
      where: {
        status: "ACTIVE",
        fulfillmentType: "DELIVERY",
        shippingStatus: "DELIVERED",
        updatedAt: { gte: start, lte: end },
      },
    }),
    db.product.count({
      where: {
        isActive: true,
        stock: { gt: 0, lte: db.product.fields.minStock },
      },
    }).catch(() => 0),
    db.product.count({
      where: {
        isActive: true,
        stock: { lte: 0 },
      },
    }),
    db.warrantyClaim.count({
      where: {
        status: { in: ["DRAFT", "SENT_TO_SUPPLIER"] },
      },
    }),
    db.adjustment.count({
      where: {
        status: "ACTIVE",
        adjustDate: { gte: start, lte: end },
      },
    }),
    db.expense.aggregate({
      _sum: { netAmount: true },
      where: {
        status: "ACTIVE",
        expenseDate: { gte: start, lte: end },
      },
    }),
    db.cashBankTransfer.aggregate({
      _sum: { amount: true },
      where: {
        status: "ACTIVE",
        transferDate: { gte: start, lte: end },
      },
    }),
    Promise.all([
      db.sale.count({ where: { status: "CANCELLED", cancelledAt: { gte: start, lte: end } } }),
      db.purchase.count({ where: { status: "CANCELLED", cancelledAt: { gte: start, lte: end } } }),
      db.receipt.count({ where: { status: "CANCELLED", cancelledAt: { gte: start, lte: end } } }),
      db.creditNote.count({ where: { status: "CANCELLED", cancelledAt: { gte: start, lte: end } } }),
      db.purchaseReturn.count({ where: { status: "CANCELLED", cancelledAt: { gte: start, lte: end } } }),
      db.expense.count({ where: { status: "CANCELLED", cancelledAt: { gte: start, lte: end } } }),
      db.adjustment.count({ where: { status: "CANCELLED", cancelledAt: { gte: start, lte: end } } }),
      db.cashBankTransfer.count({
        where: { status: "CANCELLED", cancelledAt: { gte: start, lte: end } },
      }),
      db.cashBankAdjustment.count({
        where: { status: "CANCELLED", cancelledAt: { gte: start, lte: end } },
      }),
    ]),
    getLotExpiryCounts(start, end),
  ]);

  const money: MoneySection = {
    salesTotal: toNumber(salesTotalAgg._sum.netAmount),
    cashSales: toNumber(cashSalesAgg._sum.netAmount),
    creditSales: toNumber(creditSalesAgg._sum.netAmount),
    cashInFromSales: toNumber(cashSalesAgg._sum.netAmount),
    cashInFromReceipts: toNumber(receiptTotalAgg._sum.totalAmount),
    cashInTotal:
      toNumber(cashSalesAgg._sum.netAmount) + toNumber(receiptTotalAgg._sum.totalAmount),
    cashChannelTotal:
      toNumber(cashSaleCashAgg._sum.netAmount) + toNumber(receiptCashAgg._sum.totalAmount),
    transferChannelTotal:
      toNumber(cashSaleTransferAgg._sum.netAmount) +
      toNumber(receiptTransferAgg._sum.totalAmount),
    arOutstanding: toNumber(arOutstandingAgg._sum.amountRemain),
    codOutstanding: toNumber(codOutstandingAgg._sum.amountRemain),
    apOutstanding: toNumber(apOutstandingAgg._sum.amountRemain),
    expensesToday: toNumber(expensesTodayAgg._sum.netAmount),
    transfersToday: toNumber(transfersTodayAgg._sum.amount),
  };

  const counts: CountSection = {
    pendingDelivery,
    outForDelivery,
    deliveredToday,
    lowStockCount,
    outOfStockCount,
    expiringLotCount: lotCounts.expiringLotCount,
    expiredLotCount: lotCounts.expiredLotCount,
    openClaimCount,
    cancelledDocumentCount: cancelledCounts.reduce((sum, value) => sum + value, 0),
    stockAdjustmentCount: adjustmentCount,
  };

  return {
    reportDayKey,
    reportDateLabel,
    shopName: siteConfig.shopName,
    range: { start, end },
    money,
    counts,
    message: renderLineDailySummaryMessage({
      reportDateLabel,
      money,
      counts,
    }),
  };
}
