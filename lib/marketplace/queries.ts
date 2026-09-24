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
  isManualMarketplaceChannel,
  MANUAL_MARKETPLACE_CHANNELS,
  type ManualMarketplaceChannel,
} from "./config";
import {
  calculateMarketplaceOrderOutstanding,
  isFullyReversedMarketplaceProduct,
} from "./returns";

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
  grossAmount: number;
  returnAmount: number;
  amount: number;
  creditNoteIds: string[];
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
      select: {
        id: true,
        saleNo: true,
        channelRefNo: true,
        saleDate: true,
        netAmount: true,
        creditNotes: {
          where: {
            status: DocStatus.ACTIVE,
            settlementType: CNSettlementType.CASH_REFUND,
            marketplaceSettlementLines: { none: { activeCreditNoteId: { not: null } } },
          },
          select: { id: true, totalAmount: true },
        },
      },
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
        saleId: true,
        cnNo: true,
        cnDate: true,
        totalAmount: true,
        sale: {
          select: {
            id: true,
            saleNo: true,
            marketplaceSettlementLines: {
              where: { activeSaleId: { not: null } },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
    }),
  ]);

  const pendingSaleIds = new Set(sales.map((sale) => sale.id));
  const groupedSales = sales.flatMap((sale) => {
    const grossAmount = Number(sale.netAmount);
    const returnAmount = sale.creditNotes.reduce(
      (sum, creditNote) => sum + Number(creditNote.totalAmount),
      0,
    );
    const netAmount = calculateMarketplaceOrderOutstanding(grossAmount, returnAmount);
    // คืนเต็มจำนวนแล้วไม่ต้องปล่อยใบขาย/ใบคืนค้างในหน้ากระทบยอด ทั้งสองฝั่ง
    // หักล้างกันในบัญชีพักเงินเรียบร้อยแล้ว ส่วนค่าธรรมเนียมภายหลังยังคีย์เป็น
    // บรรทัด Statement ในรอบที่แพลตฟอร์มแจ้งจริงได้ตามปกติ
    if (Math.abs(netAmount) < 0.005) return [];
    return [{
      id: sale.id,
      saleNo: sale.saleNo,
      orderRefNo: sale.channelRefNo ?? "-",
      saleDate: sale.saleDate,
      grossAmount,
      returnAmount,
      amount: netAmount,
      creditNoteIds: sale.creditNotes.map((creditNote) => creditNote.id),
    }];
  });

  return {
    sales: groupedSales,
    // ถ้าใบขายยังรอกระทบยอด ใบคืนจะถูกรวมอยู่ในแถวออเดอร์ด้านบน ไม่แสดงซ้ำ
    // ใบคืนจะแสดงเดี่ยวเฉพาะเมื่อใบขายถูกกระทบยอดไปก่อนแล้ว
    creditNotes: creditNotes.filter((creditNote) =>
      !creditNote.saleId ||
      !pendingSaleIds.has(creditNote.saleId) ||
      (creditNote.sale?.marketplaceSettlementLines.length ?? 0) > 0
    ).map((creditNote) => ({
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
  const [account, movements, pendingDocuments] = await Promise.all([
    db.cashBankAccount.findUnique({
      where: { id: holdingAccountId },
      select: { openingBalance: true },
    }),
    db.cashBankMovement.groupBy({
      by: ["direction"],
      where: { accountId: holdingAccountId },
      _sum: { amount: true },
    }),
    getPendingSettlementDocuments(channel, holdingAccountId),
  ]);

  const inflow = movements
    .filter((row) => row.direction === CashBankDirection.IN)
    .reduce((sum, row) => sum + Number(row._sum.amount ?? 0), 0);
  const outflow = movements
    .filter((row) => row.direction === CashBankDirection.OUT)
    .reduce((sum, row) => sum + Number(row._sum.amount ?? 0), 0);
  const pendingSaleAmount = pendingDocuments.sales.reduce((sum, sale) => sum + sale.amount, 0);
  const pendingReturnAmount =
    pendingDocuments.sales.reduce((sum, sale) => sum + sale.returnAmount, 0) +
    pendingDocuments.creditNotes.reduce((sum, creditNote) => sum + creditNote.amount, 0);

  return {
    channel,
    label: getMarketplaceChannelConfig(channel).label,
    holdingBalance: Number(account?.openingBalance ?? 0) + inflow - outflow,
    pendingSaleCount: pendingDocuments.sales.length,
    pendingSaleAmount,
    pendingReturnAmount,
    oldestPendingSaleDate: pendingDocuments.sales[0]?.saleDate ?? null,
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
  /** จำนวนบิลขายในงวดที่ยังไม่ถูกกระทบยอด */
  pendingSaleCount: number;
  /** ประมาณการค่าธรรมเนียมที่จะย้อนกลับมาลดกำไรของงวดนี้เมื่อแพลตฟอร์มโอนเงิน */
  estimatedPendingFee: number;
  /** อัตราและยอดค้างแยกช่องทาง เพื่อไม่ใช้ค่าเฉลี่ยรวมข้าม Shopee / Lazada */
  byChannel: Array<{
    channel: ManualMarketplaceChannel;
    averageFeeRate: number;
    sampleSettlementCount: number;
    pendingSaleCount: number;
    pendingSalesAmount: number;
    estimatedPendingFee: number;
  }>;
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
  const [settledGroups, pendingSalesGroups] = await Promise.all([
    db.marketplaceSettlement.groupBy({
      by: ["channel"],
      where: { status: DocStatus.ACTIVE },
      _count: { _all: true },
      _sum: { salesAmount: true, feeAmount: true },
    }),
    db.sale.groupBy({
      by: ["channel"],
      where: {
        channel: { in: [...MANUAL_MARKETPLACE_CHANNELS] },
        status: DocStatus.ACTIVE,
        saleDate: { gte: start, lte: end },
        marketplaceSettlementLines: { none: { activeSaleId: { not: null } } },
      },
      _count: { _all: true },
      _sum: { netAmount: true },
    }),
  ]);

  const settledByChannel = new Map(settledGroups.map((row) => [row.channel, row]));
  const pendingByChannel = new Map(pendingSalesGroups.map((row) => [row.channel, row]));
  const byChannel = MANUAL_MARKETPLACE_CHANNELS.map((channel) => {
    const settled = settledByChannel.get(channel);
    const pending = pendingByChannel.get(channel);
    const settledSales = Number(settled?._sum.salesAmount ?? 0);
    const settledFees = Number(settled?._sum.feeAmount ?? 0);
    const averageFeeRate = settledSales > 0 ? settledFees / settledSales : 0;
    const pendingSalesAmount = Number(pending?._sum.netAmount ?? 0);
    return {
      channel,
      averageFeeRate,
      sampleSettlementCount: settled?._count._all ?? 0,
      pendingSaleCount: pending?._count._all ?? 0,
      pendingSalesAmount,
      estimatedPendingFee: pendingSalesAmount * averageFeeRate,
    };
  });

  const settledSales = settledGroups.reduce(
    (sum, row) => sum + Number(row._sum.salesAmount ?? 0),
    0,
  );
  const settledFees = settledGroups.reduce(
    (sum, row) => sum + Number(row._sum.feeAmount ?? 0),
    0,
  );
  const averageFeeRate = settledSales > 0 ? settledFees / settledSales : 0;
  const pendingSaleCount = byChannel.reduce((sum, row) => sum + row.pendingSaleCount, 0);
  const pendingSalesAmount = byChannel.reduce((sum, row) => sum + row.pendingSalesAmount, 0);

  return {
    averageFeeRate,
    sampleSettlementCount: byChannel.reduce((sum, row) => sum + row.sampleSettlementCount, 0),
    pendingSaleCount,
    pendingSalesAmount,
    estimatedPendingFee: byChannel.reduce((sum, row) => sum + row.estimatedPendingFee, 0),
    byChannel,
  };
}

export type ChannelProductProfitRow = {
  channel: ManualMarketplaceChannel;
  productId: string | null;
  productName: string;
  quantity: number;
  salesAmount: number;
  grossProfit: number;
  /** null = เอกสารต้นทางยังไม่อยู่ในรอบรับเงิน จึงยังไม่มีค่าธรรมเนียมจริง */
  estimatedProfitAfterFee: number | null;
  marginPct: number;
};

export type ChannelProductProfitSection = {
  channel: ManualMarketplaceChannel;
  settled: { best: ChannelProductProfitRow[]; worst: ChannelProductProfitRow[] };
  pending: ChannelProductProfitRow[];
};

const PRODUCT_ROW_LIMIT = 10;

/**
 * กำไรรายสินค้าของช่องทาง แยกเอกสารที่กระทบยอดแล้วออกจากเอกสารที่ยังไม่มีค่าธรรมเนียมจริง
 *
 * ค่าธรรมเนียมของแพลตฟอร์มคิดรวมทั้งออเดอร์ จึงปันกลับเข้ารายสินค้าในออเดอร์เดียวกัน
 * ตามสัดส่วนยอดขาย เพื่อใช้จัดอันดับกำไรหลังค่าธรรมเนียมของสินค้านั้น
 */
export async function getChannelProductProfit(
  channels: ManualMarketplaceChannel[],
  start: Date,
  end: Date,
): Promise<ChannelProductProfitSection[]> {
  const grouped = await db.factProfit.groupBy({
    by: ["channel", "sourceType", "sourceId", "productId", "productName"],
    where: {
      isActive: true,
      businessDate: { gte: start, lte: end },
      channel: { in: channels },
      sourceType: { in: [ProfitSourceType.SALE, ProfitSourceType.SALE_RETURN] },
      productId: { not: null },
    },
    _sum: { quantity: true, salesAmountExVat: true, grossProfit: true },
  });

  const saleIds = grouped
    .filter((row) => row.sourceType === ProfitSourceType.SALE)
    .map((row) => row.sourceId);
  const creditNoteIds = grouped
    .filter((row) => row.sourceType === ProfitSourceType.SALE_RETURN)
    .map((row) => row.sourceId);
  const settlementLines = await db.marketplaceSettlementLine.findMany({
    where: {
      settlement: { status: DocStatus.ACTIVE },
      OR: [
        { saleId: { in: saleIds }, activeSaleId: { not: null } },
        { creditNoteId: { in: creditNoteIds }, activeCreditNoteId: { not: null } },
      ],
    },
    select: {
      saleId: true,
      creditNoteId: true,
      settlement: { select: { feeAmount: true, salesAmount: true } },
    },
  });
  const settledRateBySourceId = new Map<string, number>();
  for (const line of settlementLines) {
    const sourceId = line.saleId ?? line.creditNoteId;
    if (!sourceId) continue;
    const salesAmount = Number(line.settlement.salesAmount);
    settledRateBySourceId.set(
      sourceId,
      salesAmount > 0 ? Number(line.settlement.feeAmount) / salesAmount : 0,
    );
  }

  const overallByProduct = new Map<
    string,
    { quantity: number; salesAmount: number; grossProfit: number }
  >();
  for (const row of grouped) {
    if (!row.channel || !isManualMarketplaceChannel(row.channel)) continue;
    const key = `${row.channel}:${row.productId ?? row.productName ?? ""}`;
    const current = overallByProduct.get(key) ?? {
      quantity: 0,
      salesAmount: 0,
      grossProfit: 0,
    };
    current.quantity += Number(row._sum.quantity ?? 0);
    current.salesAmount += Number(row._sum.salesAmountExVat ?? 0);
    current.grossProfit += Number(row._sum.grossProfit ?? 0);
    overallByProduct.set(key, current);
  }
  const fullyReversedProductKeys = new Set(
    [...overallByProduct.entries()]
      .filter(([, totals]) => isFullyReversedMarketplaceProduct(totals))
      .map(([key]) => key),
  );

  const productRows = new Map<string, ChannelProductProfitRow>();
  for (const row of grouped) {
    if (!row.channel || !isManualMarketplaceChannel(row.channel)) continue;
    const overallKey = `${row.channel}:${row.productId ?? row.productName ?? ""}`;
    if (fullyReversedProductKeys.has(overallKey)) continue;
    const salesAmount = Number(row._sum.salesAmountExVat ?? 0);
    const grossProfit = Number(row._sum.grossProfit ?? 0);
    const feeRate = settledRateBySourceId.get(row.sourceId);
    const settlementKey = feeRate === undefined ? "pending" : "settled";
    const key = `${row.channel}:${settlementKey}:${row.productId ?? row.productName ?? ""}`;
    const current = productRows.get(key) ?? {
      channel: row.channel,
      productId: row.productId,
      productName: row.productName ?? "(ไม่ระบุสินค้า)",
      quantity: 0,
      salesAmount: 0,
      grossProfit: 0,
      estimatedProfitAfterFee: feeRate === undefined ? null : 0,
      marginPct: 0,
    };
    current.quantity += Number(row._sum.quantity ?? 0);
    current.salesAmount += salesAmount;
    current.grossProfit += grossProfit;
    if (feeRate !== undefined) {
      current.estimatedProfitAfterFee =
        (current.estimatedProfitAfterFee ?? 0) + grossProfit - salesAmount * feeRate;
    }
    productRows.set(key, current);
  }

  const rows = [...productRows.values()].map((row) => ({
    ...row,
    marginPct: row.salesAmount > 0 ? (row.grossProfit / row.salesAmount) * 100 : 0,
  }));

  return channels.map((channel) => {
    const channelRows = rows.filter((row) => row.channel === channel);
    const settled = channelRows
      .filter((row) => row.estimatedProfitAfterFee !== null)
      .sort(
        (a, b) =>
          (b.estimatedProfitAfterFee ?? 0) - (a.estimatedProfitAfterFee ?? 0),
      );
    const pending = channelRows
      .filter((row) => row.estimatedProfitAfterFee === null)
      .sort((a, b) => b.grossProfit - a.grossProfit)
      .slice(0, PRODUCT_ROW_LIMIT);
    return {
      channel,
      settled: {
        best: settled.slice(0, PRODUCT_ROW_LIMIT),
        worst: settled
          .filter((row) => (row.estimatedProfitAfterFee ?? 0) < 0)
          .slice(-PRODUCT_ROW_LIMIT)
          .reverse(),
      },
      pending,
    };
  });
}

export type FeeBreakdownRow = {
  channel: ManualMarketplaceChannel;
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
    by: ["settlementId", "feeCode", "label"],
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

  const settlementIds = grouped.map((row) => row.settlementId);
  const settlements = await db.marketplaceSettlement.findMany({
    where: { id: { in: settlementIds } },
    select: { id: true, channel: true },
  });
  const channelBySettlementId = new Map(settlements.map((row) => [row.id, row.channel]));
  const totals = new Map<string, FeeBreakdownRow>();
  for (const row of grouped) {
    const channel = channelBySettlementId.get(row.settlementId);
    if (!channel || !isManualMarketplaceChannel(channel)) continue;
    const key = `${channel}:${row.feeCode}:${row.label}`;
    const current = totals.get(key);
    if (current) {
      current.amount += Number(row._sum.amount ?? 0);
    } else {
      totals.set(key, {
        channel,
        feeCode: row.feeCode,
        label: row.label,
        amount: Number(row._sum.amount ?? 0),
      });
    }
  }
  return [...totals.values()].sort((a, b) =>
    a.channel === b.channel ? a.amount - b.amount : a.channel.localeCompare(b.channel),
  );
}
