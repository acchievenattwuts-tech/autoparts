import { db } from "@/lib/db";
import { safeWriteAuditLog } from "@/lib/audit-log";
import { AuditAction } from "@/lib/generated/prisma";
import { getReportsData, type ParsedReportFilters } from "@/lib/reports";
import { getThailandDateKey, parseDateOnlyToEndOfDay, parseDateOnlyToStartOfDay } from "@/lib/th-date";

type ReconciliationTotals = {
  grossSales: number;
  salesReturns: number;
  netRevenue: number;
  costOfGoodsSold: number;
  grossProfit: number;
  expenseTotal: number;
  netProfit: number;
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function diff(actual: number, expected: number): number {
  return roundMoney(actual - expected);
}

function buildFilters(fromInput: string, toInput: string): ParsedReportFilters {
  return {
    from: parseDateOnlyToStartOfDay(fromInput),
    to: parseDateOnlyToEndOfDay(toInput),
    fromInput,
    toInput,
    customerCodeFrom: "",
    customerCodeTo: "",
    supplierCodeFrom: "",
    supplierCodeTo: "",
    productCodeFrom: "",
    productCodeTo: "",
    expenseCodeFrom: "",
    expenseCodeTo: "",
  };
}

async function getFactTotals(from: Date, to: Date): Promise<ReconciliationTotals> {
  const aggregate = await db.factProfit.aggregate({
    _sum: {
      salesAmount: true,
      costAmount: true,
      expenseAmount: true,
      grossProfit: true,
      netProfitAmount: true,
    },
    where: {
      isActive: true,
      businessDate: { gte: from, lte: to },
    },
  });

  const salesReturnAggregate = await db.factProfit.aggregate({
    _sum: {
      salesAmount: true,
    },
    where: {
      isActive: true,
      sourceType: "SALE_RETURN",
      businessDate: { gte: from, lte: to },
    },
  });

  const grossSales = roundMoney(
    Number(aggregate._sum.salesAmount ?? 0) - Number(salesReturnAggregate._sum.salesAmount ?? 0),
  );
  const salesReturns = roundMoney(-(Number(salesReturnAggregate._sum.salesAmount ?? 0)));
  const netRevenue = roundMoney(Number(aggregate._sum.salesAmount ?? 0));
  const costOfGoodsSold = roundMoney(Number(aggregate._sum.costAmount ?? 0));
  const grossProfit = roundMoney(Number(aggregate._sum.grossProfit ?? 0));
  const expenseTotal = roundMoney(Number(aggregate._sum.expenseAmount ?? 0));
  const netProfit = roundMoney(Number(aggregate._sum.netProfitAmount ?? 0));

  return {
    grossSales,
    salesReturns,
    netRevenue,
    costOfGoodsSold,
    grossProfit,
    expenseTotal,
    netProfit,
  };
}

async function main() {
  const [minSale, minCreditNote, minExpense, maxSale, maxCreditNote, maxExpense] = await Promise.all([
    db.sale.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { saleDate: "asc" },
      select: { saleDate: true },
    }),
    db.creditNote.findFirst({
      where: { status: "ACTIVE", type: "RETURN" },
      orderBy: { cnDate: "asc" },
      select: { cnDate: true },
    }),
    db.expense.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { expenseDate: "asc" },
      select: { expenseDate: true },
    }),
    db.sale.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { saleDate: "desc" },
      select: { saleDate: true },
    }),
    db.creditNote.findFirst({
      where: { status: "ACTIVE", type: "RETURN" },
      orderBy: { cnDate: "desc" },
      select: { cnDate: true },
    }),
    db.expense.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { expenseDate: "desc" },
      select: { expenseDate: true },
    }),
  ]);

  const minDate = [minSale?.saleDate, minCreditNote?.cnDate, minExpense?.expenseDate]
    .filter((value): value is Date => value instanceof Date)
    .sort((left, right) => left.getTime() - right.getTime())[0];
  const maxDate = [maxSale?.saleDate, maxCreditNote?.cnDate, maxExpense?.expenseDate]
    .filter((value): value is Date => value instanceof Date)
    .sort((left, right) => right.getTime() - left.getTime())[0];

  if (!minDate || !maxDate) {
    console.log("No active sale / credit note return / expense data found to reconcile.");
    return;
  }

  const fromInput = getThailandDateKey(minDate);
  const toInput = getThailandDateKey(maxDate);
  const filters = buildFilters(fromInput, toInput);

  const [reportData, factTotals] = await Promise.all([
    getReportsData(filters),
    getFactTotals(filters.from, filters.to),
  ]);

  const reportTotals = reportData.profitLoss;
  const result = {
    range: { fromInput, toInput },
    report: {
      grossSales: roundMoney(reportTotals.grossSales),
      salesReturns: roundMoney(reportTotals.salesReturns),
      netRevenue: roundMoney(reportTotals.netRevenue),
      costOfGoodsSold: roundMoney(reportTotals.costOfGoodsSold),
      grossProfit: roundMoney(reportTotals.grossProfit),
      expenseTotal: roundMoney(reportTotals.expenseTotal),
      netProfit: roundMoney(reportTotals.netProfit),
    },
    fact: factTotals,
    delta: {
      grossSales: diff(factTotals.grossSales, reportTotals.grossSales),
      salesReturns: diff(factTotals.salesReturns, reportTotals.salesReturns),
      netRevenue: diff(factTotals.netRevenue, reportTotals.netRevenue),
      costOfGoodsSold: diff(factTotals.costOfGoodsSold, reportTotals.costOfGoodsSold),
      grossProfit: diff(factTotals.grossProfit, reportTotals.grossProfit),
      expenseTotal: diff(factTotals.expenseTotal, reportTotals.expenseTotal),
      netProfit: diff(factTotals.netProfit, reportTotals.netProfit),
    },
  };

  await safeWriteAuditLog({
    userName: "SYSTEM",
    userRole: "SYSTEM",
    action: AuditAction.RECALCULATE,
    entityType: "FactProfit",
    entityId: "reconcile",
    entityRef: `${fromInput} ถึง ${toInput}`,
    meta: {
      script: "reconcile-fact-profit",
      range: result.range,
      delta: result.delta,
    },
  });

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error("[reconcile-fact-profit]", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
