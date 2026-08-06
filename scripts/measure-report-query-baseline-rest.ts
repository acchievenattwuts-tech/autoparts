/**
 * Baseline measurement for the report pages not covered by
 * measure-report-query-baseline.ts (AR/AP/stock/claim-stock/cash-bank/summary).
 *
 * Read-only. Same purpose: place Suspense boundaries where the time actually is.
 *
 * Usage: npm run measure:report-queries-rest -- [days]
 */
import { db } from "../lib/db";
import {
  parseARAPStockFilters,
  queryAPData,
  queryARRows,
  queryStockRows,
} from "../lib/ar-ap-stock-report-queries";
import { queryAPRegisterRows, queryARRegisterRows } from "../lib/ar-ap-register-queries";
import {
  parseCashBankReportFilters,
  queryCashBankAdjustmentHistoryRows,
  queryCashBankLedgerData,
  queryCashBankTransferHistoryRows,
} from "../lib/cash-bank-report-queries";
import { getReportsData, parseReportFilters } from "../lib/reports";
import { formatDateOnlyForInput, getThailandDateKey, parseDateOnlyToDate } from "../lib/th-date";

const DEFAULT_RANGE_DAYS = 90;
const ITERATIONS = 3;

type Measured = { page: string; query: string; p50: number; rows: number };

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
};

const countRows = (result: unknown): number => {
  if (Array.isArray(result)) return result.length;
  if (result && typeof result === "object") {
    return Object.values(result).reduce<number>(
      (sum, value) => sum + (Array.isArray(value) ? value.length : 0),
      0,
    );
  }
  return 0;
};

const measure = async (
  page: string,
  query: string,
  run: () => Promise<unknown>,
): Promise<Measured> => {
  const timings: number[] = [];
  let rows = 0;

  for (let i = 0; i < ITERATIONS; i += 1) {
    const startedAt = performance.now();
    const result = await run();
    timings.push(performance.now() - startedAt);
    rows = countRows(result);
  }

  return { page, query, p50: median(timings), rows };
};

const main = async (): Promise<void> => {
  const rangeDays = Number(process.argv[2]) || DEFAULT_RANGE_DAYS;
  const today = parseDateOnlyToDate(getThailandDateKey());
  const fromDate = new Date(today);
  fromDate.setDate(fromDate.getDate() - rangeDays);

  const fromStr = formatDateOnlyForInput(fromDate);
  const toStr = getThailandDateKey(today);
  const rawParams = { from: fromStr, to: toStr };

  const arApStockFilters = parseARAPStockFilters(rawParams);
  const cashBankFilters = parseCashBankReportFilters(rawParams);
  const summaryFilters = parseReportFilters({ from: fromStr, to: toStr });

  console.log(`=== Remaining report pages (last ${rangeDays} days, ${ITERATIONS} runs, p50) ===`);
  console.log(`range: ${fromStr} .. ${toStr}\n`);

  const results: Measured[] = [];

  results.push(await measure("ar", "queryARRows", () => queryARRows(arApStockFilters)));
  results.push(await measure("ar", "queryARRegisterRows", () => queryARRegisterRows(arApStockFilters)));
  results.push(
    await measure("ar", "customer.findMany(500)", () =>
      db.customer.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
        take: 500,
      }),
    ),
  );
  results.push(await measure("ap", "queryAPData", () => queryAPData(arApStockFilters)));
  results.push(await measure("ap", "queryAPRegisterRows", () => queryAPRegisterRows(arApStockFilters)));
  results.push(
    await measure("ap", "supplier.findMany(500)", () =>
      db.supplier.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
        take: 500,
      }),
    ),
  );
  results.push(await measure("stock", "queryStockRows", () => queryStockRows(arApStockFilters)));
  results.push(
    await measure("cash-bank-ledger", "queryCashBankLedgerData", () =>
      queryCashBankLedgerData(cashBankFilters),
    ),
  );
  results.push(
    await measure("cash-bank-transfers", "queryCashBankTransferHistoryRows", () =>
      queryCashBankTransferHistoryRows(cashBankFilters),
    ),
  );
  results.push(
    await measure("cash-bank-adjustments", "queryCashBankAdjustmentHistoryRows", () =>
      queryCashBankAdjustmentHistoryRows(cashBankFilters),
    ),
  );
  results.push(await measure("summary", "getReportsData", () => getReportsData(summaryFilters)));

  const pad = (value: string, width: number) => value.padEnd(width);
  console.log(`${pad("page", 24)}${pad("query", 36)}${pad("p50", 12)}rows`);
  for (const result of [...results].sort((a, b) => b.p50 - a.p50)) {
    console.log(
      `${pad(result.page, 24)}${pad(result.query, 36)}${pad(`${result.p50.toFixed(1)}ms`, 12)}${result.rows}`,
    );
  }
};

main()
  .catch((error: unknown) => {
    console.error("measurement failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
