/**
 * Baseline measurement for the /admin/reports pages.
 *
 * Read-only. Times the data queries each report page awaits before it can
 * render anything, so Suspense boundaries get placed where they actually pay
 * off instead of where the code merely looks heavy.
 *
 * Usage: npm run measure:report-queries -- [days]
 */
import { db } from "../lib/db";
import {
  countSalesRowsDocs,
  parseReportQueryFilters,
  queryCreditNoteRows,
  queryDailyPaymentRows,
  queryDailyReceiptRows,
  queryPurchaseRows,
  queryPurchaseRowsTotals,
  querySalesRows,
  querySalesRowsTotals,
  type ReportFilters,
} from "../lib/report-queries";
import { formatDateOnlyForInput, getThailandDateKey, parseDateOnlyToDate } from "../lib/th-date";

const PAGE_SIZE = 100;
const DEFAULT_RANGE_DAYS = 30;
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
    if (Array.isArray(result)) rows = result.length;
    else if (typeof result === "number") rows = result;
  }

  return { page, query, p50: median(timings), rows };
};

const buildFilters = (rangeDays: number): ReportFilters => {
  const today = parseDateOnlyToDate(getThailandDateKey());
  const from = new Date(today);
  from.setDate(from.getDate() - rangeDays);

  return parseReportQueryFilters({
    from: formatDateOnlyForInput(from),
    to: getThailandDateKey(today),
  });
};

const main = async (): Promise<void> => {
  const rangeDays = Number(process.argv[2]) || DEFAULT_RANGE_DAYS;
  const filters = buildFilters(rangeDays);

  console.log(`=== Report query baseline (last ${rangeDays} days, ${ITERATIONS} runs, p50) ===`);
  console.log(`range: ${filters.fromStr} .. ${filters.toStr}\n`);

  const results: Measured[] = [];

  results.push(await measure("sales", "querySalesRows", () => querySalesRows(filters, PAGE_SIZE, 0)));
  results.push(await measure("sales", "querySalesRowsTotals", () => querySalesRowsTotals(filters)));
  results.push(await measure("sales", "countSalesRowsDocs", () => countSalesRowsDocs(filters)));
  results.push(
    await measure("sales", "cashBankAccount.findMany", () =>
      db.cashBankAccount.findMany({
        where: { isActive: true },
        orderBy: [{ type: "asc" }, { code: "asc" }],
        select: { id: true, code: true, name: true },
      }),
    ),
  );
  results.push(await measure("purchases", "queryPurchaseRows", () => queryPurchaseRows(filters, PAGE_SIZE, 0)));
  results.push(await measure("purchases", "queryPurchaseRowsTotals", () => queryPurchaseRowsTotals(filters)));
  results.push(await measure("credit-notes", "queryCreditNoteRows", () => queryCreditNoteRows(filters)));
  // receipts/payments render the "daily" variants, not the export-only ones.
  results.push(await measure("receipts", "queryDailyReceiptRows", () => queryDailyReceiptRows(filters)));
  results.push(await measure("payments", "queryDailyPaymentRows", () => queryDailyPaymentRows(filters)));

  const pad = (value: string, width: number) => value.padEnd(width);
  console.log(`${pad("page", 14)}${pad("query", 28)}${pad("p50", 12)}rows`);
  for (const result of [...results].sort((a, b) => b.p50 - a.p50)) {
    console.log(
      `${pad(result.page, 14)}${pad(result.query, 28)}${pad(`${result.p50.toFixed(1)}ms`, 12)}${result.rows}`,
    );
  }

  const byPage = new Map<string, number>();
  for (const result of results) {
    byPage.set(result.page, Math.max(byPage.get(result.page) ?? 0, result.p50));
  }
  console.log("\n--- slowest query per page (what a Suspense boundary would hide) ---");
  for (const [page, slowest] of [...byPage].sort((a, b) => b[1] - a[1])) {
    console.log(`${pad(page, 14)}${slowest.toFixed(1)}ms`);
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
