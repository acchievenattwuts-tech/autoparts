import { db } from "@/lib/db";
import { ProfitSourceType } from "@/lib/generated/prisma";
import {
  addThailandDays,
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

export type ProfitAlertSeverity = "high" | "medium" | "low";

export type ProfitAlert = {
  severity: ProfitAlertSeverity;
  kind: "low_margin" | "loss" | "cost_spike";
  title: string;
  detail: string;
  productId: string | null;
  productCode: string | null;
  productName: string | null;
  invoiceCount: number;
};

export type ProfitPagination = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type ProfitSummary = {
  salesAmountExVat: number;
  salesAmountIncVat: number;
  costAmount: number;
  expenseAmount: number;
  grossProfit: number;
  netProfitAmount: number;
  marginPct: number;
};

type PaginatedSection<T> = {
  items: T[];
  pagination: ProfitPagination;
};

export type ProfitDashboardData = {
  filters: ProfitDashboardFilters;
  today: ProfitSummary;
  yesterday: ProfitSummary;
  selectedRange: ProfitSummary;
  previousRange: ProfitSummary;
  trend: ProfitTrendPoint[];
  topProducts: ProfitProductRow[];
  lowProducts: ProfitProductRow[];
  stockProducts: PaginatedSection<ProfitProductRow>;
  customerAnalysis: PaginatedSection<ProfitCustomerRow>;
  invoices: PaginatedSection<ProfitInvoiceRow>;
  alerts: ProfitAlert[];
};

type ProfitDashboardQueryInput = Partial<ProfitDashboardFilters> & {
  stockPage?: number;
  customerPage?: number;
  invoicePage?: number;
};

const ANALYSIS_PAGE_SIZE = 10;

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

function parsePage(value?: number): number {
  if (!value || !Number.isFinite(value) || value < 1) {
    return 1;
  }

  return Math.floor(value);
}

function buildPagination(page: number, totalItems: number): ProfitPagination {
  const totalPages = Math.max(1, Math.ceil(totalItems / ANALYSIS_PAGE_SIZE));

  return {
    page: Math.min(page, totalPages),
    pageSize: ANALYSIS_PAGE_SIZE,
    totalItems,
    totalPages,
  };
}

export async function aggregateProfitSummary(start: Date, end: Date): Promise<ProfitSummary> {
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

async function buildTrend(from: string, to: string): Promise<ProfitTrendPoint[]> {
  const trendMap = new Map<string, ProfitTrendPoint>();
  const start = parseDateOnlyToStartOfDay(from);
  const end = parseDateOnlyToStartOfDay(to);

  for (let cursor = new Date(start); cursor <= end; cursor = addThailandDays(cursor, 1)) {
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

  const grouped = await db.factProfit.groupBy({
    by: ["businessDate"],
    _sum: {
      salesAmountExVat: true,
      salesAmountIncVat: true,
      costAmount: true,
      grossProfit: true,
      netProfitAmount: true,
    },
    where: {
      isActive: true,
      businessDate: {
        gte: parseDateOnlyToStartOfDay(from),
        lte: parseDateOnlyToEndOfDay(to),
      },
    },
    orderBy: {
      businessDate: "asc",
    },
  });

  for (const row of grouped) {
    const dateKey = getThailandDateKey(row.businessDate);
    const entry = trendMap.get(dateKey);
    if (!entry) continue;

    entry.salesAmountExVat = asNumber(row._sum.salesAmountExVat);
    entry.salesAmountIncVat = asNumber(row._sum.salesAmountIncVat);
    entry.costAmount = asNumber(row._sum.costAmount);
    entry.grossProfit = asNumber(row._sum.grossProfit);
    entry.netProfitAmount = asNumber(row._sum.netProfitAmount);
    entry.marginPct = calcMarginPct(entry.grossProfit, entry.salesAmountExVat);
  }

  return Array.from(trendMap.values());
}

function mapProductRow(row: {
  productId: string | null;
  productCode: string | null;
  productName: string | null;
  _sum: {
    quantity: unknown;
    salesAmountExVat: unknown;
    salesAmountIncVat: unknown;
    costAmount: unknown;
    grossProfit: unknown;
  };
}): ProfitProductRow {
  const quantity = asNumber(row._sum.quantity);
  const salesAmountExVat = asNumber(row._sum.salesAmountExVat);
  const salesAmountIncVat = asNumber(row._sum.salesAmountIncVat);
  const grossProfit = asNumber(row._sum.grossProfit);

  return {
    productId: row.productId ?? "",
    productCode: row.productCode ?? null,
    productName: row.productName ?? "สินค้าไม่ระบุ",
    quantity,
    salesAmountExVat,
    salesAmountIncVat,
    costAmount: asNumber(row._sum.costAmount),
    grossProfit,
    marginPct: calcMarginPct(grossProfit, salesAmountExVat),
    unitProfit: Math.abs(quantity) > 0.0001 ? roundMoney(grossProfit / Math.abs(quantity)) : 0,
  };
}

async function getProductSpotlights(
  fromDate: Date,
  toDate: Date,
): Promise<{ topProducts: ProfitProductRow[]; lowProducts: ProfitProductRow[] }> {
  const where = {
    isActive: true,
    sourceType: { in: [ProfitSourceType.SALE, ProfitSourceType.SALE_RETURN] as ProfitSourceType[] },
    businessDate: { gte: fromDate, lte: toDate },
    productId: { not: null as string | null },
    productName: { not: null as string | null },
  };

  const [topGrouped, lowGrouped] = await Promise.all([
    db.factProfit.groupBy({
      by: ["productId", "productCode", "productName"],
      _sum: {
        quantity: true,
        salesAmountExVat: true,
        salesAmountIncVat: true,
        costAmount: true,
        grossProfit: true,
      },
      where,
      orderBy: [{ _sum: { grossProfit: "desc" } }, { productName: "asc" }],
      take: 5,
    }),
    db.factProfit.groupBy({
      by: ["productId", "productCode", "productName"],
      _sum: {
        quantity: true,
        salesAmountExVat: true,
        salesAmountIncVat: true,
        costAmount: true,
        grossProfit: true,
      },
      where,
      orderBy: [{ _sum: { grossProfit: "asc" } }, { productName: "asc" }],
      take: 5,
    }),
  ]);

  return {
    topProducts: topGrouped.map(mapProductRow),
    lowProducts: lowGrouped.map(mapProductRow),
  };
}

async function getProductAnalysis(
  fromDate: Date,
  toDate: Date,
  page: number,
): Promise<PaginatedSection<ProfitProductRow>> {
  const where = {
    isActive: true,
    sourceType: { in: [ProfitSourceType.SALE, ProfitSourceType.SALE_RETURN] as ProfitSourceType[] },
    businessDate: { gte: fromDate, lte: toDate },
    productId: { not: null as string | null },
    productName: { not: null as string | null },
  };

  const totalItems = (
    await db.factProfit.groupBy({
      by: ["productId", "productCode", "productName"],
      where,
    })
  ).length;
  const pagination = buildPagination(page, totalItems);
  const grouped = await db.factProfit.groupBy({
    by: ["productId", "productCode", "productName"],
    _sum: {
      quantity: true,
      salesAmountExVat: true,
      salesAmountIncVat: true,
      costAmount: true,
      grossProfit: true,
    },
    where,
    orderBy: [
      { _sum: { grossProfit: "desc" } },
      { _sum: { quantity: "desc" } },
      { productName: "asc" },
    ],
    skip: (pagination.page - 1) * pagination.pageSize,
    take: pagination.pageSize,
  });

  return {
    items: grouped.map(mapProductRow),
    pagination,
  };
}

async function getAllProductAnalysis(fromDate: Date, toDate: Date): Promise<ProfitProductRow[]> {
  const where = {
    isActive: true,
    sourceType: { in: [ProfitSourceType.SALE, ProfitSourceType.SALE_RETURN] as ProfitSourceType[] },
    businessDate: { gte: fromDate, lte: toDate },
    productId: { not: null as string | null },
    productName: { not: null as string | null },
  };

  const grouped = await db.factProfit.groupBy({
    by: ["productId", "productCode", "productName"],
    _sum: {
      quantity: true,
      salesAmountExVat: true,
      salesAmountIncVat: true,
      costAmount: true,
      grossProfit: true,
    },
    where,
    orderBy: [{ productName: "asc" }],
  });

  return grouped.map(mapProductRow);
}

function buildCustomerKey(customerId: string | null, customerName: string | null): string {
  return customerId ?? `guest:${customerName?.trim() || "ลูกค้าไม่ระบุ"}`;
}

async function getCustomerAnalysis(
  fromDate: Date,
  toDate: Date,
  page: number,
): Promise<PaginatedSection<ProfitCustomerRow>> {
  const where = {
    isActive: true,
    sourceType: { in: [ProfitSourceType.SALE, ProfitSourceType.SALE_RETURN] as ProfitSourceType[] },
    businessDate: { gte: fromDate, lte: toDate },
  };

  const totalItems = (
    await db.factProfit.groupBy({
      by: ["customerId", "customerName"],
      where,
    })
  ).length;
  const pagination = buildPagination(page, totalItems);
  const grouped = await db.factProfit.groupBy({
    by: ["customerId", "customerName"],
    _sum: {
      quantity: true,
      salesAmountExVat: true,
      salesAmountIncVat: true,
      costAmount: true,
      grossProfit: true,
    },
    where,
    orderBy: [
      { _sum: { grossProfit: "desc" } },
      { _sum: { salesAmountExVat: "desc" } },
      { customerName: "asc" },
    ],
    skip: (pagination.page - 1) * pagination.pageSize,
    take: pagination.pageSize,
  });

  const invoiceGroupRows = await db.factProfit.groupBy({
    by: ["customerId", "customerName", "sourceId"],
    where,
  });

  const invoiceCountMap = new Map<string, number>();
  for (const row of invoiceGroupRows) {
    const key = buildCustomerKey(row.customerId ?? null, row.customerName ?? null);
    invoiceCountMap.set(key, (invoiceCountMap.get(key) ?? 0) + 1);
  }

  return {
    items: grouped.map((row) => {
      const quantity = asNumber(row._sum.quantity);
      const salesAmountExVat = asNumber(row._sum.salesAmountExVat);
      const grossProfit = asNumber(row._sum.grossProfit);

      return {
        customerId: row.customerId ?? null,
        customerName: row.customerName?.trim() || "ลูกค้าไม่ระบุ",
        invoiceCount:
          invoiceCountMap.get(buildCustomerKey(row.customerId ?? null, row.customerName ?? null)) ??
          0,
        quantity,
        salesAmountExVat,
        salesAmountIncVat: asNumber(row._sum.salesAmountIncVat),
        costAmount: asNumber(row._sum.costAmount),
        grossProfit,
        marginPct: calcMarginPct(grossProfit, salesAmountExVat),
      };
    }),
    pagination,
  };
}

async function getInvoiceAnalysis(
  fromDate: Date,
  toDate: Date,
  page: number,
): Promise<PaginatedSection<ProfitInvoiceRow>> {
  const where = {
    isActive: true,
    sourceType: { in: [ProfitSourceType.SALE, ProfitSourceType.SALE_RETURN] as ProfitSourceType[] },
    businessDate: { gte: fromDate, lte: toDate },
  };

  const totalItems = (
    await db.factProfit.groupBy({
      by: ["sourceId", "sourceType", "sourceDocNo", "businessDate", "customerName"],
      where,
    })
  ).length;
  const pagination = buildPagination(page, totalItems);
  const grouped = await db.factProfit.groupBy({
    by: ["sourceId", "sourceType", "sourceDocNo", "businessDate", "customerName"],
    _sum: {
      salesAmountExVat: true,
      salesAmountIncVat: true,
      costAmount: true,
      grossProfit: true,
    },
    where,
    orderBy: [{ _sum: { grossProfit: "desc" } }, { businessDate: "desc" }],
    skip: (pagination.page - 1) * pagination.pageSize,
    take: pagination.pageSize,
  });

  return {
    items: grouped.map((row) => {
      const salesAmountExVat = asNumber(row._sum.salesAmountExVat);
      const grossProfit = asNumber(row._sum.grossProfit);

      return {
        sourceId: row.sourceId,
        sourceType: row.sourceType,
        sourceDocNo: row.sourceDocNo,
        businessDate: row.businessDate,
        customerName: row.customerName ?? null,
        salesAmountExVat,
        salesAmountIncVat: asNumber(row._sum.salesAmountIncVat),
        costAmount: asNumber(row._sum.costAmount),
        grossProfit,
        marginPct: calcMarginPct(grossProfit, salesAmountExVat),
      };
    }),
    pagination,
  };
}

function buildProductInvoiceCountMap(
  rows: Array<{ productId: string | null; sourceId: string }>,
): Map<string, number> {
  const sourceIdsByProduct = new Map<string, Set<string>>();

  for (const row of rows) {
    if (!row.productId) continue;
    const sourceIds = sourceIdsByProduct.get(row.productId) ?? new Set<string>();
    sourceIds.add(row.sourceId);
    sourceIdsByProduct.set(row.productId, sourceIds);
  }

  return new Map(
    Array.from(sourceIdsByProduct.entries()).map(([productId, sourceIds]) => [
      productId,
      sourceIds.size,
    ]),
  );
}

function getSeverityRank(severity: ProfitAlertSeverity): number {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

async function buildAlerts(fromDate: Date, toDate: Date): Promise<ProfitAlert[]> {
  const products = await getAllProductAnalysis(fromDate, toDate);
  const alertCandidates: Array<ProfitAlert & { score: number }> = [];

  const invoiceRows = await db.factProfit.groupBy({
    by: ["productId", "sourceId"],
    where: {
      isActive: true,
      sourceType: { in: [ProfitSourceType.SALE, ProfitSourceType.SALE_RETURN] as ProfitSourceType[] },
      businessDate: { gte: fromDate, lte: toDate },
      productId: { not: null },
    },
  });
  const invoiceCountMap = buildProductInvoiceCountMap(invoiceRows);

  for (const product of products) {
    const invoiceCount = invoiceCountMap.get(product.productId) ?? 0;

    if (product.grossProfit < 0) {
      const lossAmount = Math.abs(product.grossProfit);
      const severity: ProfitAlertSeverity =
        lossAmount >= 1000 || product.marginPct <= -10
          ? "high"
          : lossAmount >= 250 || product.marginPct < 0
            ? "medium"
            : "low";

      alertCandidates.push({
        severity,
        kind: "loss",
        title: `${product.productName} ขาดทุน`,
        detail: `กำไรขั้นต้นติดลบ ${lossAmount.toLocaleString("th-TH", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} บาท และ margin ${product.marginPct.toFixed(2)}% ในช่วงวิเคราะห์`,
        productId: product.productId,
        productCode: product.productCode,
        productName: product.productName,
        invoiceCount,
        score: lossAmount,
      });
    }

    if (product.salesAmountExVat > 0 && product.marginPct > 0 && product.marginPct < 20) {
      const severity: ProfitAlertSeverity =
        product.marginPct < 5 ? "high" : product.marginPct < 12 ? "medium" : "low";

      alertCandidates.push({
        severity,
        kind: "low_margin",
        title: `${product.productName} มาร์จิ้นต่ำ`,
        detail: `Margin เหลือ ${product.marginPct.toFixed(2)}% จากยอดขายก่อน VAT ${product.salesAmountExVat.toLocaleString(
          "th-TH",
          {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          },
        )} บาท`,
        productId: product.productId,
        productCode: product.productCode,
        productName: product.productName,
        invoiceCount,
        score: 100 - product.marginPct,
      });
    }
  }

  const todayKey = getThailandDateKey();
  const todayStart = parseDateOnlyToStartOfDay(todayKey);
  const recentBoundary = addThailandDays(todayStart, -6);
  const previousBoundary = addThailandDays(recentBoundary, -7);
  const recentRows = await db.factProfit.findMany({
    where: {
      isActive: true,
      sourceType: ProfitSourceType.SALE,
      businessDate: {
        gte: previousBoundary,
        lte: toDate > todayStart ? parseDateOnlyToEndOfDay(todayKey) : toDate,
      },
      productId: { not: null },
      productName: { not: null },
    },
    select: {
      productId: true,
      productName: true,
      businessDate: true,
      quantity: true,
      unitCostPrice: true,
    },
  });

  const recentCostMap = new Map<string, { recentQty: number; recentCost: number }>();
  const previousCostMap = new Map<string, { previousQty: number; previousCost: number }>();

  for (const row of recentRows) {
    if (!row.productId || !row.productName) continue;

    const quantity = Math.abs(asNumber(row.quantity));
    const unitCost = asNumber(row.unitCostPrice);
    if (quantity <= 0) continue;

    if (row.businessDate.getTime() >= recentBoundary.getTime()) {
      const existing = recentCostMap.get(row.productId) ?? { recentQty: 0, recentCost: 0 };
      existing.recentQty += quantity;
      existing.recentCost += quantity * unitCost;
      recentCostMap.set(row.productId, existing);
    } else {
      const existing = previousCostMap.get(row.productId) ?? {
        previousQty: 0,
        previousCost: 0,
      };
      existing.previousQty += quantity;
      existing.previousCost += quantity * unitCost;
      previousCostMap.set(row.productId, existing);
    }
  }

  for (const product of products) {
    const recent = recentCostMap.get(product.productId);
    const previous = previousCostMap.get(product.productId);
    if (!recent || !previous || previous.previousQty <= 0 || recent.recentQty <= 0) continue;

    const recentAvg = recent.recentCost / recent.recentQty;
    const previousAvg = previous.previousCost / previous.previousQty;
    const increasePct = ((recentAvg - previousAvg) / previousAvg) * 100;
    if (increasePct <= 15) continue;

    const severity: ProfitAlertSeverity =
      increasePct >= 40 ? "high" : increasePct >= 25 ? "medium" : "low";

    alertCandidates.push({
      severity,
      kind: "cost_spike",
      title: `${product.productName} ต้นทุนเฉลี่ยพุ่ง`,
      detail: `ต้นทุนเฉลี่ยล่าสุด ${recentAvg.toFixed(2)} บาท สูงกว่าช่วงก่อน ${increasePct.toFixed(
        2,
      )}%`,
      productId: product.productId,
      productCode: product.productCode,
      productName: product.productName,
      invoiceCount: invoiceCountMap.get(product.productId) ?? 0,
      score: increasePct,
    });
  }

  return alertCandidates
    .sort((left, right) => {
      const severityDelta = getSeverityRank(right.severity) - getSeverityRank(left.severity);
      if (severityDelta !== 0) return severityDelta;

      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) return scoreDelta;

      return (left.productName ?? "").localeCompare(right.productName ?? "", "th");
    })
    .slice(0, 12)
    .map(({ score: _score, ...alert }) => alert);
}

export async function getProfitDashboardData(
  input?: ProfitDashboardQueryInput,
): Promise<ProfitDashboardData> {
  const todayKey = getThailandDateKey();
  const defaultFrom = getThailandMonthStartDateKey();
  const from = input?.from && input.from.length > 0 ? input.from : defaultFrom;
  const to = input?.to && input.to.length > 0 ? input.to : todayKey;
  const basis = input?.basis === "inc_vat" ? "inc_vat" : "ex_vat";
  const stockPage = parsePage(input?.stockPage);
  const customerPage = parsePage(input?.customerPage);
  const invoicePage = parsePage(input?.invoicePage);
  const fromDate = parseDateOnlyToStartOfDay(from);
  const toDate = parseDateOnlyToEndOfDay(to);
  const todayStart = parseDateOnlyToStartOfDay(todayKey);
  const todayEnd = parseDateOnlyToEndOfDay(todayKey);
  const yesterdayStart = addThailandDays(todayStart, -1);
  const yesterdayEnd = parseDateOnlyToEndOfDay(getThailandDateKey(yesterdayStart));
  const currentRangeStart = fromDate;
  const currentRangeEnd = toDate;
  const currentRangeEndDay = parseDateOnlyToStartOfDay(to);
  const rangeDays =
    Math.floor(
      (currentRangeEndDay.getTime() - currentRangeStart.getTime()) / (1000 * 60 * 60 * 24),
    ) + 1;
  const previousRangeEndDay = addThailandDays(currentRangeStart, -1);
  const previousRangeStartDay = addThailandDays(currentRangeStart, -rangeDays);
  const previousRangeStart = parseDateOnlyToStartOfDay(getThailandDateKey(previousRangeStartDay));
  const previousRangeEnd = parseDateOnlyToEndOfDay(getThailandDateKey(previousRangeEndDay));

  const [
    today,
    yesterday,
    selectedRange,
    previousRange,
    trend,
    productSpotlights,
    stockProducts,
    customerAnalysis,
    invoices,
    alerts,
  ] = await Promise.all([
    aggregateProfitSummary(todayStart, todayEnd),
    aggregateProfitSummary(yesterdayStart, yesterdayEnd),
    aggregateProfitSummary(currentRangeStart, currentRangeEnd),
    aggregateProfitSummary(previousRangeStart, previousRangeEnd),
    buildTrend(from, to),
    getProductSpotlights(fromDate, toDate),
    getProductAnalysis(fromDate, toDate, stockPage),
    getCustomerAnalysis(fromDate, toDate, customerPage),
    getInvoiceAnalysis(fromDate, toDate, invoicePage),
    buildAlerts(fromDate, toDate),
  ]);

  return {
    filters: { from, to, basis },
    today,
    yesterday,
    selectedRange,
    previousRange,
    trend,
    topProducts: productSpotlights.topProducts,
    lowProducts: productSpotlights.lowProducts,
    stockProducts,
    customerAnalysis,
    invoices,
    alerts,
  };
}
