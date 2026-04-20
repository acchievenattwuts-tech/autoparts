import { db } from "@/lib/db";
import { ProfitSourceType } from "@/lib/generated/prisma";
import {
  getThailandDateKey,
  getThailandMonthStartDateKey,
  parseDateOnlyToEndOfDay,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";

export type ProfitRevenueBasis = "ex_vat" | "inc_vat";

export type ProfitDashboardFilters = {
  from: string;
  to: string;
  basis: ProfitRevenueBasis;
};

export type ProfitTrendPoint = {
  dateKey: string;
  salesAmountExVat: number;
  salesAmountIncVat: number;
  costAmount: number;
  grossProfit: number;
  netProfitAmount: number;
  marginPct: number;
};

export type ProfitProductRow = {
  productId: string;
  productCode: string | null;
  productName: string;
  quantity: number;
  salesAmountExVat: number;
  salesAmountIncVat: number;
  costAmount: number;
  grossProfit: number;
  marginPct: number;
  unitProfit: number;
};

export type ProfitInvoiceRow = {
  sourceId: string;
  sourceType: ProfitSourceType;
  sourceDocNo: string;
  businessDate: Date;
  customerName: string | null;
  salesAmountExVat: number;
  salesAmountIncVat: number;
  costAmount: number;
  grossProfit: number;
  marginPct: number;
};

export type ProfitCustomerRow = {
  customerId: string | null;
  customerName: string;
  invoiceCount: number;
  quantity: number;
  salesAmountExVat: number;
  salesAmountIncVat: number;
  costAmount: number;
  grossProfit: number;
  marginPct: number;
};

export type ProfitAlert = {
  kind: "low_margin" | "loss" | "cost_spike";
  title: string;
  detail: string;
};

type ProfitSummary = {
  salesAmountExVat: number;
  salesAmountIncVat: number;
  costAmount: number;
  expenseAmount: number;
  grossProfit: number;
  netProfitAmount: number;
  marginPct: number;
};

export type ProfitDashboardData = {
  filters: ProfitDashboardFilters;
  today: ProfitSummary;
  yesterday: ProfitSummary;
  trend: ProfitTrendPoint[];
  topProducts: ProfitProductRow[];
  lowProducts: ProfitProductRow[];
  stockProducts: ProfitProductRow[];
  customerAnalysis: ProfitCustomerRow[];
  invoices: ProfitInvoiceRow[];
  alerts: ProfitAlert[];
  monthComparison: {
    currentMonthNetProfit: number;
    previousMonthNetProfit: number;
    currentMonthSalesExVat: number;
    previousMonthSalesExVat: number;
    currentMonthSalesIncVat: number;
    previousMonthSalesIncVat: number;
    currentMonthExpense: number;
    previousMonthExpense: number;
  };
};

type FactRow = {
  businessDate: Date;
  sourceType: ProfitSourceType;
  sourceId: string;
  sourceDocNo: string;
  customerId: string | null;
  customerName: string | null;
  productId: string | null;
  productCode: string | null;
  productName: string | null;
  quantity: unknown;
  salesAmountExVat: unknown;
  salesAmountIncVat: unknown;
  costAmount: unknown;
  expenseAmount: unknown;
  grossProfit: unknown;
  netProfitAmount: unknown;
  unitCostPrice: unknown;
};

function asNumber(value: unknown): number {
  return Number(value ?? 0);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPct(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function getRevenueAmountByBasis(
  values: { exVat: number; incVat: number },
  basis: ProfitRevenueBasis,
): number {
  return basis === "inc_vat" ? values.incVat : values.exVat;
}

function calcMarginPct(grossProfit: number, salesAmountExVat: number): number {
  if (Math.abs(salesAmountExVat) < 0.0001) {
    return 0;
  }

  return roundPct((grossProfit / salesAmountExVat) * 100);
}

function buildEmptySummary(): ProfitSummary {
  return {
    salesAmountExVat: 0,
    salesAmountIncVat: 0,
    costAmount: 0,
    expenseAmount: 0,
    grossProfit: 0,
    netProfitAmount: 0,
    marginPct: 0,
  };
}

async function aggregateSummary(start: Date, end: Date): Promise<ProfitSummary> {
  const aggregate = await db.factProfit.aggregate({
    _sum: {
      salesAmountExVat: true,
      salesAmountIncVat: true,
      costAmount: true,
      expenseAmount: true,
      grossProfit: true,
      netProfitAmount: true,
    },
    where: {
      isActive: true,
      businessDate: {
        gte: start,
        lte: end,
      },
    },
  });

  const salesAmountExVat = asNumber(aggregate._sum.salesAmountExVat);
  const salesAmountIncVat = asNumber(aggregate._sum.salesAmountIncVat);
  const costAmount = asNumber(aggregate._sum.costAmount);
  const expenseAmount = asNumber(aggregate._sum.expenseAmount);
  const grossProfit = asNumber(aggregate._sum.grossProfit);
  const netProfitAmount = asNumber(aggregate._sum.netProfitAmount);

  return {
    salesAmountExVat,
    salesAmountIncVat,
    costAmount,
    expenseAmount,
    grossProfit,
    netProfitAmount,
    marginPct: calcMarginPct(grossProfit, salesAmountExVat),
  };
}

function buildTrend(rows: FactRow[], from: string, to: string): ProfitTrendPoint[] {
  const trendMap = new Map<string, ProfitTrendPoint>();
  const start = parseDateOnlyToStartOfDay(from);
  const end = parseDateOnlyToStartOfDay(to);

  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const dateKey = getThailandDateKey(cursor);
    trendMap.set(dateKey, {
      dateKey,
      salesAmountExVat: 0,
      salesAmountIncVat: 0,
      costAmount: 0,
      grossProfit: 0,
      netProfitAmount: 0,
      marginPct: 0,
    });
  }

  for (const row of rows) {
    const dateKey = getThailandDateKey(row.businessDate);
    const entry = trendMap.get(dateKey);
    if (!entry) continue;

    entry.salesAmountExVat = roundMoney(
      entry.salesAmountExVat + asNumber(row.salesAmountExVat),
    );
    entry.salesAmountIncVat = roundMoney(
      entry.salesAmountIncVat + asNumber(row.salesAmountIncVat),
    );
    entry.costAmount = roundMoney(entry.costAmount + asNumber(row.costAmount));
    entry.grossProfit = roundMoney(entry.grossProfit + asNumber(row.grossProfit));
    entry.netProfitAmount = roundMoney(
      entry.netProfitAmount + asNumber(row.netProfitAmount),
    );
    entry.marginPct = calcMarginPct(entry.grossProfit, entry.salesAmountExVat);
  }

  return Array.from(trendMap.values());
}

function buildProductRows(rows: FactRow[]): ProfitProductRow[] {
  const productMap = new Map<string, ProfitProductRow>();

  for (const row of rows) {
    if (!row.productId || !row.productName) continue;
    if (
      row.sourceType !== ProfitSourceType.SALE &&
      row.sourceType !== ProfitSourceType.SALE_RETURN
    ) {
      continue;
    }

    const existing = productMap.get(row.productId) ?? {
      productId: row.productId,
      productCode: row.productCode,
      productName: row.productName,
      quantity: 0,
      salesAmountExVat: 0,
      salesAmountIncVat: 0,
      costAmount: 0,
      grossProfit: 0,
      marginPct: 0,
      unitProfit: 0,
    };

    existing.quantity = roundMoney(existing.quantity + asNumber(row.quantity));
    existing.salesAmountExVat = roundMoney(
      existing.salesAmountExVat + asNumber(row.salesAmountExVat),
    );
    existing.salesAmountIncVat = roundMoney(
      existing.salesAmountIncVat + asNumber(row.salesAmountIncVat),
    );
    existing.costAmount = roundMoney(existing.costAmount + asNumber(row.costAmount));
    existing.grossProfit = roundMoney(existing.grossProfit + asNumber(row.grossProfit));
    existing.marginPct = calcMarginPct(existing.grossProfit, existing.salesAmountExVat);
    existing.unitProfit =
      Math.abs(existing.quantity) > 0.0001
        ? roundMoney(existing.grossProfit / Math.abs(existing.quantity))
        : 0;

    productMap.set(row.productId, existing);
  }

  return Array.from(productMap.values());
}

function buildInvoiceRows(rows: FactRow[]): ProfitInvoiceRow[] {
  const invoiceMap = new Map<string, ProfitInvoiceRow>();

  for (const row of rows) {
    if (
      row.sourceType !== ProfitSourceType.SALE &&
      row.sourceType !== ProfitSourceType.SALE_RETURN
    ) {
      continue;
    }

    const existing = invoiceMap.get(row.sourceId) ?? {
      sourceId: row.sourceId,
      sourceType: row.sourceType,
      sourceDocNo: row.sourceDocNo,
      businessDate: row.businessDate,
      customerName: row.customerName,
      salesAmountExVat: 0,
      salesAmountIncVat: 0,
      costAmount: 0,
      grossProfit: 0,
      marginPct: 0,
    };

    existing.salesAmountExVat = roundMoney(
      existing.salesAmountExVat + asNumber(row.salesAmountExVat),
    );
    existing.salesAmountIncVat = roundMoney(
      existing.salesAmountIncVat + asNumber(row.salesAmountIncVat),
    );
    existing.costAmount = roundMoney(existing.costAmount + asNumber(row.costAmount));
    existing.grossProfit = roundMoney(existing.grossProfit + asNumber(row.grossProfit));
    existing.marginPct = calcMarginPct(existing.grossProfit, existing.salesAmountExVat);

    invoiceMap.set(row.sourceId, existing);
  }

  return Array.from(invoiceMap.values()).sort(
    (left, right) =>
      right.grossProfit - left.grossProfit ||
      right.businessDate.getTime() - left.businessDate.getTime(),
  );
}

function buildCustomerRows(rows: FactRow[]): ProfitCustomerRow[] {
  const customerMap = new Map<string, ProfitCustomerRow & { sourceIds: Set<string> }>();

  for (const row of rows) {
    if (
      row.sourceType !== ProfitSourceType.SALE &&
      row.sourceType !== ProfitSourceType.SALE_RETURN
    ) {
      continue;
    }

    const customerKey =
      row.customerId ?? `guest:${(row.customerName ?? "ลูกค้าไม่ระบุ").trim() || "ลูกค้าไม่ระบุ"}`;
    const customerName = row.customerName?.trim() || "ลูกค้าไม่ระบุ";

    const existing = customerMap.get(customerKey) ?? {
      customerId: row.customerId ?? null,
      customerName,
      invoiceCount: 0,
      quantity: 0,
      salesAmountExVat: 0,
      salesAmountIncVat: 0,
      costAmount: 0,
      grossProfit: 0,
      marginPct: 0,
      sourceIds: new Set<string>(),
    };

    existing.quantity = roundMoney(existing.quantity + asNumber(row.quantity));
    existing.salesAmountExVat = roundMoney(
      existing.salesAmountExVat + asNumber(row.salesAmountExVat),
    );
    existing.salesAmountIncVat = roundMoney(
      existing.salesAmountIncVat + asNumber(row.salesAmountIncVat),
    );
    existing.costAmount = roundMoney(existing.costAmount + asNumber(row.costAmount));
    existing.grossProfit = roundMoney(existing.grossProfit + asNumber(row.grossProfit));
    existing.sourceIds.add(row.sourceId);
    existing.invoiceCount = existing.sourceIds.size;
    existing.marginPct = calcMarginPct(existing.grossProfit, existing.salesAmountExVat);

    customerMap.set(customerKey, existing);
  }

  return Array.from(customerMap.values()).map(({ sourceIds: _sourceIds, ...row }) => row);
}

function buildAlerts(rows: FactRow[], productRows: ProfitProductRow[]): ProfitAlert[] {
  const alerts: ProfitAlert[] = [];

  for (const product of productRows) {
    if (product.salesAmountExVat > 0 && product.marginPct > 0 && product.marginPct < 20) {
      alerts.push({
        kind: "low_margin",
        title: `${product.productName} มาร์จิ้นต่ำ`,
        detail: `มาร์จิ้น ${product.marginPct.toFixed(2)}% ในช่วงวิเคราะห์`,
      });
    }

    if (product.grossProfit < 0) {
      alerts.push({
        kind: "loss",
        title: `${product.productName} ขาดทุน`,
        detail: `กำไรขั้นต้น ${product.grossProfit.toLocaleString("th-TH", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} บาท`,
      });
    }
  }

  const todayKey = getThailandDateKey();
  const recentCostMap = new Map<string, { recentQty: number; recentCost: number }>();
  const previousCostMap = new Map<string, { previousQty: number; previousCost: number }>();
  const todayStart = parseDateOnlyToStartOfDay(todayKey);
  const recentBoundary = new Date(todayStart);
  recentBoundary.setUTCDate(recentBoundary.getUTCDate() - 6);
  const previousBoundary = new Date(recentBoundary);
  previousBoundary.setUTCDate(previousBoundary.getUTCDate() - 7);

  for (const row of rows) {
    if (row.sourceType !== ProfitSourceType.SALE || !row.productId || !row.productName) continue;

    const businessTime = row.businessDate.getTime();
    const quantity = Math.abs(asNumber(row.quantity));
    const unitCost = asNumber(row.unitCostPrice);
    if (quantity <= 0) continue;

    if (businessTime >= recentBoundary.getTime()) {
      const existing = recentCostMap.get(row.productId) ?? { recentQty: 0, recentCost: 0 };
      existing.recentQty += quantity;
      existing.recentCost += quantity * unitCost;
      recentCostMap.set(row.productId, existing);
    } else if (businessTime >= previousBoundary.getTime()) {
      const existing = previousCostMap.get(row.productId) ?? {
        previousQty: 0,
        previousCost: 0,
      };
      existing.previousQty += quantity;
      existing.previousCost += quantity * unitCost;
      previousCostMap.set(row.productId, existing);
    }
  }

  for (const product of productRows) {
    const recent = recentCostMap.get(product.productId);
    const previous = previousCostMap.get(product.productId);
    if (!recent || !previous || previous.previousQty <= 0 || recent.recentQty <= 0) continue;

    const recentAvg = recent.recentCost / recent.recentQty;
    const previousAvg = previous.previousCost / previous.previousQty;
    if (recentAvg > previousAvg * 1.15) {
      alerts.push({
        kind: "cost_spike",
        title: `${product.productName} ต้นทุนเฉลี่ยพุ่ง`,
        detail: `ต้นทุนเฉลี่ยล่าสุด ${recentAvg.toFixed(2)} บาท สูงกว่าช่วงก่อน ${(
          ((recentAvg - previousAvg) / previousAvg) *
          100
        ).toFixed(2)}%`,
      });
    }
  }

  return alerts.slice(0, 8);
}

export async function getProfitDashboardData(
  filters?: Partial<ProfitDashboardFilters>,
): Promise<ProfitDashboardData> {
  const todayKey = getThailandDateKey();
  const defaultFrom = getThailandMonthStartDateKey();
  const from = filters?.from && filters.from.length > 0 ? filters.from : defaultFrom;
  const to = filters?.to && filters.to.length > 0 ? filters.to : todayKey;
  const basis = filters?.basis === "inc_vat" ? "inc_vat" : "ex_vat";
  const fromDate = parseDateOnlyToStartOfDay(from);
  const toDate = parseDateOnlyToEndOfDay(to);
  const todayStart = parseDateOnlyToStartOfDay(todayKey);
  const todayEnd = parseDateOnlyToEndOfDay(todayKey);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
  const yesterdayEnd = new Date(todayEnd);
  yesterdayEnd.setUTCDate(yesterdayEnd.getUTCDate() - 1);
  const currentMonthStart = parseDateOnlyToStartOfDay(getThailandMonthStartDateKey());
  const previousMonthEnd = new Date(currentMonthStart);
  previousMonthEnd.setUTCMilliseconds(previousMonthEnd.getUTCMilliseconds() - 1);
  const previousMonthDateKey = getThailandDateKey(previousMonthEnd);
  const previousMonthStart = parseDateOnlyToStartOfDay(
    getThailandMonthStartDateKey(previousMonthEnd),
  );

  const [today, yesterday, currentMonth, previousMonth, rows] = await Promise.all([
    aggregateSummary(todayStart, todayEnd),
    aggregateSummary(yesterdayStart, yesterdayEnd),
    aggregateSummary(currentMonthStart, todayEnd),
    aggregateSummary(previousMonthStart, parseDateOnlyToEndOfDay(previousMonthDateKey)),
    db.factProfit.findMany({
      where: {
        isActive: true,
        businessDate: {
          gte: fromDate,
          lte: toDate,
        },
      },
      orderBy: [{ businessDate: "asc" }, { sourceDocNo: "asc" }],
      select: {
        businessDate: true,
        sourceType: true,
        sourceId: true,
        sourceDocNo: true,
        customerId: true,
        customerName: true,
        productId: true,
        productCode: true,
        productName: true,
        quantity: true,
        salesAmountExVat: true,
        salesAmountIncVat: true,
        costAmount: true,
        expenseAmount: true,
        grossProfit: true,
        netProfitAmount: true,
        unitCostPrice: true,
      },
    }),
  ]);

  const trend = buildTrend(rows, from, to);
  const productRows = buildProductRows(rows);
  const topProducts = [...productRows]
    .sort(
      (left, right) =>
        right.grossProfit - left.grossProfit || right.salesAmountExVat - left.salesAmountExVat,
    )
    .slice(0, 8);
  const lowProducts = [...productRows]
    .sort((left, right) => left.grossProfit - right.grossProfit || left.marginPct - right.marginPct)
    .slice(0, 8);
  const stockProducts = [...productRows]
    .sort(
      (left, right) =>
        right.grossProfit - left.grossProfit ||
        right.quantity - left.quantity ||
        left.productName.localeCompare(right.productName),
    )
    .slice(0, 12);
  const customerAnalysis = buildCustomerRows(rows)
    .sort(
      (left, right) =>
        right.grossProfit - left.grossProfit ||
        right.salesAmountExVat - left.salesAmountExVat ||
        left.customerName.localeCompare(right.customerName),
    )
    .slice(0, 12);
  const invoices = buildInvoiceRows(rows).slice(0, 12);
  const alerts = buildAlerts(rows, productRows);

  return {
    filters: { from, to, basis },
    today: today ?? buildEmptySummary(),
    yesterday: yesterday ?? buildEmptySummary(),
    trend,
    topProducts,
    lowProducts,
    stockProducts,
    customerAnalysis,
    invoices,
    alerts,
    monthComparison: {
      currentMonthNetProfit: currentMonth.netProfitAmount,
      previousMonthNetProfit: previousMonth.netProfitAmount,
      currentMonthSalesExVat: currentMonth.salesAmountExVat,
      previousMonthSalesExVat: previousMonth.salesAmountExVat,
      currentMonthSalesIncVat: currentMonth.salesAmountIncVat,
      previousMonthSalesIncVat: previousMonth.salesAmountIncVat,
      currentMonthExpense: currentMonth.expenseAmount,
      previousMonthExpense: previousMonth.expenseAmount,
    },
  };
}
