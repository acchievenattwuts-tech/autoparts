import assert from "node:assert/strict";
import test, { before, mock } from "node:test";
import type { ProfitDashboardData, ProfitSummary } from "@/lib/profit-dashboard";
import { parseDateOnlyToDate } from "@/lib/th-date";

// T3: STOCK_VALUE_RESIDUAL facts (sourceId = productId) count like the DN variance in the dashboard's
// document list, link to the product's stock card, and never borrow a supplier name.

const moduleMocksUnavailable = typeof (mock as { module?: unknown }).module !== "function" && "requires --experimental-test-module-mocks";
type Fact = { isActive: boolean; sourceType: string; sourceId: string; sourceSubtype: string | null; sourceDocNo: string;
  businessDate: Date; customerName: string | null; salesAmountExVat: number; salesAmountIncVat: number; costAmount: number; grossProfit: number };
type GroupByArgs = { by: Array<keyof Fact>; where: { isActive: boolean; sourceType: { in: string[] }; businessDate: { gte: Date; lte: Date } };
  _sum?: Partial<Record<keyof Fact, true>>; skip?: number; take?: number };

const residual = (docNo: string, day: string, cost: number): Fact => ({ isActive: true, sourceType: "STOCK_VALUE_RESIDUAL", sourceId: "sku-1",
  sourceSubtype: "RETURN_OUT", sourceDocNo: docNo, businessDate: parseDateOnlyToDate(day), customerName: null,
  salesAmountExVat: 0, salesAmountIncVat: 0, costAmount: cost, grossProfit: -cost });
const facts: Fact[] = [residual("PR-1", "2026-10-05", 200), residual("PR-2", "2026-10-09", 0.01)];
let debitNameQueries = 0;
let sourceTypeFilters: string[][] = [];
let dashboard: typeof import("@/lib/profit-dashboard");
let evidence: typeof import("@/lib/profit-explanation/evidence");
let shared: typeof import("@/app/admin/(protected)/ProfitSectionShared");

const groupBy = (args: GroupByArgs): Array<Record<string, unknown>> => {
  sourceTypeFilters.push(args.where.sourceType.in);
  const groups = new Map<string, Record<string, unknown> & { _sum: Record<string, number> }>();
  for (const fact of facts.filter((row) => args.where.sourceType.in.includes(row.sourceType))) {
    const key = JSON.stringify(args.by.map((field) => fact[field]));
    const group = groups.get(key) ?? { ...Object.fromEntries(args.by.map((field) => [field, fact[field]])), _sum: {} };
    for (const field of Object.keys(args._sum ?? {}) as Array<keyof Fact>) group._sum[field] = (group._sum[field] ?? 0) + Number(fact[field]);
    groups.set(key, group);
  }
  return [...groups.values()].slice(args.skip ?? 0, args.take === undefined ? undefined : (args.skip ?? 0) + args.take);
};

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("next/cache", { namedExports: {
    unstable_cache: <Args extends unknown[], Result>(callback: (...args: Args) => Promise<Result>) => callback,
    revalidateTag: (): void => undefined,
  } });
  await mock.module("@/lib/db", { namedExports: {
    withDbRetry: <T>(operation: () => Promise<T>): Promise<T> => operation(),
    db: {
      factProfit: { groupBy: async (args: GroupByArgs) => groupBy(args) },
      supplierDebitNote: { findMany: async () => { debitNameQueries += 1; return []; } },
    },
  } });
  dashboard = await import("@/lib/profit-dashboard");
  evidence = await import("@/lib/profit-explanation/evidence");
  shared = await import("@/app/admin/(protected)/ProfitSectionShared");
});

const emptySummary: ProfitSummary = { salesAmountExVat: 0, salesAmountIncVat: 0, costAmount: 0, expenseAmount: 0, grossProfit: 0,
  netProfitAmount: 0, marginPct: 0 };

test("residual rows list one row per written-off document with its cost, linking to the stock card", { skip: moduleMocksUnavailable }, async () => {
  sourceTypeFilters = []; debitNameQueries = 0;
  const section = await dashboard.getProfitInvoiceSection({ from: "2026-10-01", to: "2026-10-31", page: 1 });
  assert.ok(sourceTypeFilters.every((types) => types.includes("STOCK_VALUE_RESIDUAL") && !types.includes("EXPENSE")));
  assert.deepEqual(section.items.map((row) => [row.sourceDocNo, row.costAmount, row.grossProfit, row.customerName]).toSorted(),
    [["PR-1", 200, -200, null], ["PR-2", 0.01, -0.01, null]]);
  assert.equal(debitNameQueries, 0, "no supplier lookup for residual rows");
  assert.equal(shared.buildInvoiceHref(section.items[0].sourceType, "sku-1"), "/admin/stock/card?productId=sku-1");

  const data: ProfitDashboardData = { filters: { from: "2026-10-01", to: "2026-10-31", basis: "ex_vat" },
    today: emptySummary, yesterday: emptySummary, selectedRange: emptySummary, previousRange: emptySummary, trend: [],
    topProducts: [], lowProducts: [], alerts: [], stockProducts: { items: [], pagination: section.pagination },
    customerAnalysis: { items: [], pagination: section.pagination }, invoices: section };
  const links = evidence.buildProfitExplanationEvidence(data).evidenceLinks.filter((link) => link.id.startsWith("invoice:"));
  assert.equal(new Set(links.map((link) => link.id)).size, 2, "one product with two residual rows keeps unique evidence ids");
  assert.ok(links.every((link) => link.href === "/admin/stock/card?productId=sku-1"));
});
