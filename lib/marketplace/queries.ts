import { db } from "@/lib/db";
import {
  CashBankDirection,
  CNSettlementType,
  CreditNoteType,
  DocStatus,
  ProfitSourceType,
} from "@/lib/generated/prisma";
import {
  getMarketplaceChannelConfig,
  MANUAL_MARKETPLACE_CHANNELS,
  type ManualMarketplaceChannel,
} from "./config";

/** จำนวนเอกสารสูงสุดที่ดึงมาให้เลือกในหน้ากระทบยอดหนึ่งรอบ */
const PENDING_DOC_LIMIT = 200;

export type MarketplaceChannelSettingRow = {
  id: string;
  channel: ManualMarketplaceChannel;
  settlementCashBankAccountId: string;
  defaultCustomerId: string;
  holdingAccountLabel: string;
  defaultCustomerName: string;
};

export async function getMarketplaceChannelSetting(
  channel: ManualMarketplaceChannel,
): Promise<MarketplaceChannelSettingRow | null> {
  const row = await db.marketplaceChannelSetting.findFirst({
    where: { channel, isActive: true },
    select: {
      id: true,
      channel: true,
      settlementCashBankAccountId: true,
      defaultCustomerId: true,
      settlementCashBankAccount: { select: { code: true, name: true } },
      defaultCustomer: { select: { name: true } },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    channel,
    settlementCashBankAccountId: row.settlementCashBankAccountId,
    defaultCustomerId: row.defaultCustomerId,
    holdingAccountLabel: `${row.settlementCashBankAccount.code} — ${row.settlementCashBankAccount.name}`,
    defaultCustomerName: row.defaultCustomer.name,
  };
}

export type PendingSaleRow = {
  id: string;
  saleNo: string;
  orderRefNo: string;
  saleDate: Date;
  amount: number;
};

export type PendingCreditNoteRow = {
  id: string;
  cnNo: string;
  saleNo: string;
  cnDate: Date;
  amount: number;
};

/**
 * เอกสารที่ยังไม่ถูกกระทบยอด — ทั้งใบขาย (เงินที่แพลตฟอร์มยังไม่โอน) และใบลดหนี้
 * (ยอดที่จะถูกหักออกจากรอบถัดไป) กรองด้วยบัญชีพักเงินของช่องทางเพื่อไม่ให้ใบที่
 * เคยตั้งค่าไว้กับบัญชีอื่นหลุดเข้ามาในรอบ
 */
export async function getPendingSettlementDocuments(
  channel: ManualMarketplaceChannel,
  holdingAccountId: string,
): Promise<{ sales: PendingSaleRow[]; creditNotes: PendingCreditNoteRow[] }> {
  const [sales, creditNotes] = await Promise.all([
    db.sale.findMany({
      where: {
        channel,
        status: DocStatus.ACTIVE,
        cashBankAccountId: holdingAccountId,
        marketplaceSettlementLines: { none: { activeSaleId: { not: null } } },
      },
      orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }],
      take: PENDING_DOC_LIMIT,
      select: { id: true, saleNo: true, channelRefNo: true, saleDate: true, netAmount: true },
    }),
    db.creditNote.findMany({
      where: {
        channel,
        status: DocStatus.ACTIVE,
        settlementType: CNSettlementType.CASH_REFUND,
        cashBankAccountId: holdingAccountId,
        marketplaceSettlementLines: { none: { activeCreditNoteId: { not: null } } },
      },
      orderBy: [{ cnDate: "asc" }, { cnNo: "asc" }],
      take: PENDING_DOC_LIMIT,
      select: {
        id: true,
        cnNo: true,
        cnDate: true,
        totalAmount: true,
        sale: { select: { saleNo: true } },
      },
    }),
  ]);

  return {
    sales: sales.map((sale) => ({
      id: sale.id,
      saleNo: sale.saleNo,
      orderRefNo: sale.channelRefNo ?? "-",
      saleDate: sale.saleDate,
      amount: Number(sale.netAmount),
    })),
    creditNotes: creditNotes.map((creditNote) => ({
      id: creditNote.id,
      cnNo: creditNote.cnNo,
      saleNo: creditNote.sale?.saleNo ?? "-",
      cnDate: creditNote.cnDate,
      amount: Number(creditNote.totalAmount),
    })),
  };
}

export type ChannelProfitRow = {
  channel: ManualMarketplaceChannel | "STORE";
  label: string;
  salesAmount: number;
  costAmount: number;
  grossProfit: number;
  feeAmount: number;
  incomeAmount: number;
  contribution: number;
};

export type MarketplaceProfitOverview = {
  rows: ChannelProfitRow[];
  /** ค่าใช้จ่ายที่ไม่ผูกช่องทาง (ค่าไฟ เงินเดือน ฯลฯ) — ไม่ปันส่วนเข้าช่องทางโดยเจตนา */
  sharedExpenseAmount: number;
  totalNetProfit: number;
};

const CHANNEL_LABELS: Record<string, string> = {
  STORE: "หน้าร้าน",
  ...Object.fromEntries(
    MANUAL_MARKETPLACE_CHANNELS.map((channel) => [
      channel,
      getMarketplaceChannelConfig(channel).label,
    ]),
  ),
};

/**
 * กำไรแยกช่องทางในช่วงวันที่ที่เลือก
 *
 * กำไรขั้นต้นรวม SALE และ SALE_RETURN เข้าด้วยกันเสมอ (ยอดคืนถูกเก็บเป็นค่าลบอยู่แล้ว)
 * มิฉะนั้นกำไรของช่องทางจะสูงเกินจริงเท่ากับยอดที่ลูกค้าคืนไป
 *
 * "เหลือจริง" (contribution) คือกำไรขั้นต้นหลังหักค่าธรรมเนียมช่องทางและบวกรายรับพิเศษ
 * ยังไม่ใช่กำไรสุทธิ เพราะค่าใช้จ่ายส่วนกลางไม่ได้ผูกกับช่องทางใดช่องทางหนึ่ง
 */
export async function getMarketplaceProfitOverview(
  start: Date,
  end: Date,
): Promise<MarketplaceProfitOverview> {
  const range = { gte: start, lte: end };
  const [saleGroups, expenseGroups, incomeGroups, sharedExpense] = await Promise.all([
    db.factProfit.groupBy({
      by: ["channel"],
      where: {
        isActive: true,
        businessDate: range,
        sourceType: { in: [ProfitSourceType.SALE, ProfitSourceType.SALE_RETURN] },
      },
      _sum: { salesAmountExVat: true, costAmount: true, grossProfit: true },
    }),
    db.factProfit.groupBy({
      by: ["channel"],
      where: {
        isActive: true,
        businessDate: range,
        sourceType: ProfitSourceType.EXPENSE,
        channel: { not: null },
      },
      _sum: { expenseAmount: true },
    }),
    db.factProfit.groupBy({
      by: ["channel"],
      where: { isActive: true, businessDate: range, sourceType: ProfitSourceType.OTHER_INCOME },
      _sum: { netProfitAmount: true },
    }),
    db.factProfit.aggregate({
      where: {
        isActive: true,
        businessDate: range,
        sourceType: ProfitSourceType.EXPENSE,
        channel: null,
      },
      _sum: { expenseAmount: true },
    }),
  ]);

  const byChannel = new Map<string, ChannelProfitRow>();
  const ensureRow = (channel: string | null): ChannelProfitRow => {
    const key = channel ?? "STORE";
    const existing = byChannel.get(key);
    if (existing) return existing;
    const row: ChannelProfitRow = {
      channel: key as ChannelProfitRow["channel"],
      label: CHANNEL_LABELS[key] ?? key,
      salesAmount: 0,
      costAmount: 0,
      grossProfit: 0,
      feeAmount: 0,
      incomeAmount: 0,
      contribution: 0,
    };
    byChannel.set(key, row);
    return row;
  };

  for (const group of saleGroups) {
    const row = ensureRow(group.channel);
    row.salesAmount += Number(group._sum.salesAmountExVat ?? 0);
    row.costAmount += Number(group._sum.costAmount ?? 0);
    row.grossProfit += Number(group._sum.grossProfit ?? 0);
  }
  for (const group of expenseGroups) {
    ensureRow(group.channel).feeAmount += Number(group._sum.expenseAmount ?? 0);
  }
  for (const group of incomeGroups) {
    ensureRow(group.channel).incomeAmount += Number(group._sum.netProfitAmount ?? 0);
  }

  const rows = [...byChannel.values()].map((row) => ({
    ...row,
    contribution: row.grossProfit - row.feeAmount + row.incomeAmount,
  }));
  rows.sort((a, b) => (a.channel === "STORE" ? -1 : b.channel === "STORE" ? 1 : a.label.localeCompare(b.label)));

  const sharedExpenseAmount = Number(sharedExpense._sum.expenseAmount ?? 0);
  return {
    rows,
    sharedExpenseAmount,
    totalNetProfit: rows.reduce((sum, row) => sum + row.contribution, 0) - sharedExpenseAmount,
  };
}

export type ChannelCashHealth = {
  channel: ManualMarketplaceChannel;
  label: string;
  /** ยอดคงเหลือในบัญชีพักเงิน = เงินที่แพลตฟอร์มยังไม่โอน */
  holdingBalance: number;
  pendingSaleCount: number;
  pendingSaleAmount: number;
  pendingReturnAmount: number;
  /** วันที่ของใบขายเก่าสุดที่ยังไม่ได้เงิน — ใช้เตือนว่าแพลตฟอร์มค้างจ่ายนานผิดปกติ */
  oldestPendingSaleDate: Date | null;
};

export async function getChannelCashHealth(
  channel: ManualMarketplaceChannel,
  holdingAccountId: string,
): Promise<ChannelCashHealth> {
  const [account, movements, pendingSales, pendingReturns, oldest] = await Promise.all([
    db.cashBankAccount.findUnique({
      where: { id: holdingAccountId },
      select: { openingBalance: true },
    }),
    db.cashBankMovement.groupBy({
      by: ["direction"],
      where: { accountId: holdingAccountId },
      _sum: { amount: true },
    }),
    db.sale.aggregate({
      where: {
        channel,
        status: DocStatus.ACTIVE,
        cashBankAccountId: holdingAccountId,
        marketplaceSettlementLines: { none: { activeSaleId: { not: null } } },
      },
      _count: true,
      _sum: { netAmount: true },
    }),
    db.creditNote.aggregate({
      where: {
        channel,
        status: DocStatus.ACTIVE,
        settlementType: CNSettlementType.CASH_REFUND,
        cashBankAccountId: holdingAccountId,
        marketplaceSettlementLines: { none: { activeCreditNoteId: { not: null } } },
      },
      _sum: { totalAmount: true },
    }),
    db.sale.findFirst({
      where: {
        channel,
        status: DocStatus.ACTIVE,
        cashBankAccountId: holdingAccountId,
        marketplaceSettlementLines: { none: { activeSaleId: { not: null } } },
      },
      orderBy: { saleDate: "asc" },
      select: { saleDate: true },
    }),
  ]);

  const inflow = movements
    .filter((row) => row.direction === CashBankDirection.IN)
    .reduce((sum, row) => sum + Number(row._sum.amount ?? 0), 0);
  const outflow = movements
    .filter((row) => row.direction === CashBankDirection.OUT)
    .reduce((sum, row) => sum + Number(row._sum.amount ?? 0), 0);

  return {
    channel,
    label: getMarketplaceChannelConfig(channel).label,
    holdingBalance: Number(account?.openingBalance ?? 0) + inflow - outflow,
    pendingSaleCount: pendingSales._count,
    pendingSaleAmount: Number(pendingSales._sum.netAmount ?? 0),
    pendingReturnAmount: Number(pendingReturns._sum.totalAmount ?? 0),
    oldestPendingSaleDate: oldest?.saleDate ?? null,
  };
}

export type ChannelReturnRate = {
  saleCount: number;
  returnCount: number;
  salesAmount: number;
  returnAmount: number;
  returnRatePct: number;
};

export async function getChannelReturnRate(
  channel: ManualMarketplaceChannel,
  start: Date,
  end: Date,
): Promise<ChannelReturnRate> {
  const [sales, returns] = await Promise.all([
    db.sale.aggregate({
      where: { channel, status: DocStatus.ACTIVE, saleDate: { gte: start, lte: end } },
      _count: true,
      _sum: { netAmount: true },
    }),
    db.creditNote.aggregate({
      where: {
        channel,
        status: DocStatus.ACTIVE,
        type: CreditNoteType.RETURN,
        cnDate: { gte: start, lte: end },
      },
      _count: true,
      _sum: { totalAmount: true },
    }),
  ]);

  const salesAmount = Number(sales._sum.netAmount ?? 0);
  const returnAmount = Number(returns._sum.totalAmount ?? 0);
  return {
    saleCount: sales._count,
    returnCount: returns._count,
    salesAmount,
    returnAmount,
    returnRatePct: salesAmount > 0 ? (returnAmount / salesAmount) * 100 : 0,
  };
}

/**
 * บัญชีพักเงินของช่องทาง — ใช้โดยโมดูล Shopee API ที่ต้องรู้ปลายทางของยอดขาย
 * โดยไม่ต้องผูกกับตาราง ShopeeShop อีกต่อไป (การตั้งค่าย้ายมาอยู่ที่ marketplace แล้ว)
 */
export async function getMarketplaceHoldingAccountId(
  channel: ManualMarketplaceChannel,
): Promise<string | null> {
  const row = await db.marketplaceChannelSetting.findFirst({
    where: { channel, isActive: true },
    select: { settlementCashBankAccountId: true },
  });
  return row?.settlementCashBankAccountId ?? null;
}

export type ChannelFeeRateEstimate = {
  /** อัตราค่าธรรมเนียมเฉลี่ยจากรอบรับเงินที่ผ่านมา (สัดส่วน ไม่ใช่เปอร์เซ็นต์) */
  averageFeeRate: number;
  sampleSettlementCount: number;
  /** ยอดขายในงวดที่ยังไม่ถูกกระทบยอด — ค่าธรรมเนียมของก้อนนี้ยังไม่เข้ากำไร */
  pendingSalesAmount: number;
  /** ประมาณการค่าธรรมเนียมที่จะย้อนกลับมาลดกำไรของงวดนี้เมื่อแพลตฟอร์มโอนเงิน */
  estimatedPendingFee: number;
};

/**
 * ประมาณค่าธรรมเนียมที่ "ยังไม่รับรู้" ของงวดหนึ่ง
 *
 * ค่าธรรมเนียมจะเข้ากำไรก็ต่อเมื่อกระทบยอดแล้ว และถูกลงวันที่ย้อนกลับไปวันขาย
 * ดังนั้นงวดที่ยังมีออเดอร์ค้างรับเงินจะเห็นกำไรสูงกว่าความจริงชั่วคราว จนกว่า
 * แพลตฟอร์มจะโอน ตัวเลขนี้ใช้เตือนก่อนปิดงวด/ปันผล ว่ากำไรจะถูกปรับลดอีกเท่าไร
 */
export async function estimatePendingChannelFees(
  start: Date,
  end: Date,
): Promise<ChannelFeeRateEstimate> {
  const [settled, pendingSales] = await Promise.all([
    db.marketplaceSettlement.aggregate({
      where: { status: DocStatus.ACTIVE },
      _count: true,
      _sum: { salesAmount: true, feeAmount: true },
    }),
    db.sale.aggregate({
      where: {
        channel: { in: [...MANUAL_MARKETPLACE_CHANNELS] },
        status: DocStatus.ACTIVE,
        saleDate: { gte: start, lte: end },
        marketplaceSettlementLines: { none: { activeSaleId: { not: null } } },
      },
      _sum: { netAmount: true },
    }),
  ]);

  const settledSales = Number(settled._sum.salesAmount ?? 0);
  const settledFees = Number(settled._sum.feeAmount ?? 0);
  const averageFeeRate = settledSales > 0 ? settledFees / settledSales : 0;
  const pendingSalesAmount = Number(pendingSales._sum.netAmount ?? 0);

  return {
    averageFeeRate,
    sampleSettlementCount: settled._count,
    pendingSalesAmount,
    estimatedPendingFee: pendingSalesAmount * averageFeeRate,
  };
}

export type ChannelProductProfitRow = {
  productId: string | null;
  productName: string;
  quantity: number;
  salesAmount: number;
  grossProfit: number;
  /** กำไรหลังหักค่าธรรมเนียมโดยประมาณ (ใช้อัตราเฉลี่ยของช่องทาง) */
  estimatedProfitAfterFee: number;
  marginPct: number;
};

const PRODUCT_ROW_LIMIT = 10;

/**
 * กำไรรายสินค้าของช่องทาง พร้อมประมาณกำไรหลังค่าธรรมเนียม
 *
 * ค่าธรรมเนียมของแพลตฟอร์มคิดรวมทั้งออเดอร์ ไม่ได้แยกรายสินค้า จึงต้องปันด้วย
 * อัตราเฉลี่ยของช่องทาง — ตัวเลขนี้ใช้เพื่อ "จัดอันดับ" ว่าสินค้าตัวไหนเสี่ยงขาดทุน
 * หลังโดนค่าคอม ไม่ใช่ตัวเลขทางบัญชีของสินค้ารายตัว
 */
export async function getChannelProductProfit(
  channels: ManualMarketplaceChannel[],
  start: Date,
  end: Date,
  averageFeeRate: number,
): Promise<{ best: ChannelProductProfitRow[]; worst: ChannelProductProfitRow[] }> {
  const grouped = await db.factProfit.groupBy({
    by: ["productId", "productName"],
    where: {
      isActive: true,
      businessDate: { gte: start, lte: end },
      channel: { in: channels },
      sourceType: { in: [ProfitSourceType.SALE, ProfitSourceType.SALE_RETURN] },
      productId: { not: null },
    },
    _sum: { quantity: true, salesAmountExVat: true, grossProfit: true },
  });

  const rows: ChannelProductProfitRow[] = grouped.map((row) => {
    const salesAmount = Number(row._sum.salesAmountExVat ?? 0);
    const grossProfit = Number(row._sum.grossProfit ?? 0);
    return {
      productId: row.productId,
      productName: row.productName ?? "(ไม่ระบุสินค้า)",
      quantity: Number(row._sum.quantity ?? 0),
      salesAmount,
      grossProfit,
      estimatedProfitAfterFee: grossProfit - salesAmount * averageFeeRate,
      marginPct: salesAmount > 0 ? (grossProfit / salesAmount) * 100 : 0,
    };
  });

  const sorted = [...rows].sort(
    (a, b) => b.estimatedProfitAfterFee - a.estimatedProfitAfterFee,
  );
  return {
    best: sorted.slice(0, PRODUCT_ROW_LIMIT),
    worst: sorted
      .filter((row) => row.estimatedProfitAfterFee < 0)
      .slice(-PRODUCT_ROW_LIMIT)
      .reverse(),
  };
}

export type FeeBreakdownRow = {
  feeCode: string;
  label: string;
  amount: number;
};

export async function getChannelFeeBreakdown(
  channels: ManualMarketplaceChannel[],
  start: Date,
  end: Date,
): Promise<FeeBreakdownRow[]> {
  const grouped = await db.marketplaceSettlementFee.groupBy({
    by: ["feeCode", "label"],
    where: {
      settlement: {
        status: DocStatus.ACTIVE,
        channel: { in: channels },
        settlementDate: { gte: start, lte: end },
      },
    },
    _sum: { amount: true },
    orderBy: { _sum: { amount: "asc" } },
  });

  return grouped.map((row) => ({
    feeCode: row.feeCode,
    label: row.label,
    amount: Number(row._sum.amount ?? 0),
  }));
}
