import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import type { ProfitDashboardData, ProfitSummary } from "@/lib/profit-dashboard";
import { parseDateOnlyToDate, parseDateOnlyToEndOfDay } from "@/lib/th-date";

// V8 (W4): a ลดราคาซื้อ variance fact (PURCHASE_COST_VARIANCE, subtype PURCHASE_ALLOWANCE, sourceId = purchase return)
// shows its supplier and links to the purchase return on the profit dashboard and in the explanation evidence, and
// the P&L report adds it to the purchase cost variance inside cost of goods sold.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" && "requires --experimental-test-module-mocks";

type IdQuery = { where?: { id?: { in: string[] } } };
const businessDate = parseDateOnlyToDate("2026-09-30");
const groupedRows = [
  { sourceId: "pr-1", sourceType: "PURCHASE_COST_VARIANCE", sourceSubtype: "PURCHASE_ALLOWANCE", sourceDocNo: "PR26093000001",
    businessDate, customerName: null, _sum: { salesAmountExVat: 0, salesAmountIncVat: 0, costAmount: -120, grossProfit: 120 } },
  { sourceId: "dn-1", sourceType: "PURCHASE_COST_VARIANCE", sourceSubtype: "SUPPLIER_DN", sourceDocNo: "SDN26093000001",
    businessDate, customerName: null, _sum: { salesAmountExVat: 0, salesAmountIncVat: 0, costAmount: 30, grossProfit: -30 } },
];
const debitQueries: IdQuery[] = [];
const returnQueries: IdQuery[] = [];
const rawQueries: Array<{ sql: string; values: unknown[] }> = [];
let allowanceTotal: number | null = -120;

let dashboard: typeof import("@/lib/profit-dashboard");
let evidence: typeof import("@/lib/profit-explanation/evidence");
let reports: typeof import("@/lib/reports");

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("next/cache", { namedExports: {
    unstable_cache: <Args extends unknown[], Result>(callback: (...args: Args) => Promise<Result>) => callback,
    revalidateTag: (): void => undefined,
    revalidatePath: (): void => undefined,
  } });
  const emptyModel = { findMany: async () => [] };
  const models: Record<string, unknown> = {
    factProfit: { groupBy: async () => groupedRows },
    supplierDebitNote: { findMany: async (args: IdQuery) => {
      if (!args.where?.id) return [];
      debitQueries.push(args);
      return args.where.id.in.map((id) => ({ id, supplier: { name: "Supplier DN" } }));
    } },
    purchaseReturn: { findMany: async (args: IdQuery) => {
      if (!args.where?.id) return [];
      returnQueries.push(args);
      return args.where.id.in.map((id) => ({ id, supplier: { name: "Supplier PR" } }));
    } },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      rawQueries.push({ sql, values });
      if (!sql.includes("PURCHASE_ALLOWANCE")) return [];
      return [{ total: allowanceTotal === null ? null : new Prisma.Decimal(allowanceTotal) }];
    },
  };
  const db = new Proxy(models, { get: (target, key: string) => target[key] ?? emptyModel });
  await mock.module("@/lib/db", { namedExports: { db, withDbRetry: <T>(operation: () => Promise<T>): Promise<T> => operation() } });
  dashboard = await import("@/lib/profit-dashboard");
  evidence = await import("@/lib/profit-explanation/evidence");
  reports = await import("@/lib/reports");
});

beforeEach(() => {
  debitQueries.length = 0; returnQueries.length = 0; rawQueries.length = 0; allowanceTotal = -120;
});

const emptySummary: ProfitSummary = { salesAmountExVat: 0, salesAmountIncVat: 0, costAmount: 0,
  expenseAmount: 0, grossProfit: 0, netProfitAmount: 0, marginPct: 0 };

test("dashboard: the ลดราคาซื้อ row names the return's supplier; evidence links the purchase return", { skip: moduleMocksUnavailable }, async () => {
  const section = await dashboard.getProfitInvoiceSection({ from: "2026-09-01", to: "2026-09-30", page: 1 });
  const allowance = section.items.find((row) => row.sourceId === "pr-1");
  assert.deepEqual([allowance?.customerName, allowance?.sourceSubtype, allowance?.costAmount, allowance?.grossProfit],
    ["Supplier PR", "PURCHASE_ALLOWANCE", -120, 120]);
  assert.equal(section.items.find((row) => row.sourceId === "dn-1")?.customerName, "Supplier DN");
  assert.deepEqual(returnQueries.map((query) => query.where?.id?.in), [["pr-1"]]);
  assert.deepEqual(debitQueries.map((query) => query.where?.id?.in), [["dn-1"]], "the DN lookup no longer receives the return id");

  const data: ProfitDashboardData = {
    filters: { from: "2026-09-01", to: "2026-09-30", basis: "ex_vat" },
    today: emptySummary, yesterday: emptySummary, selectedRange: emptySummary, previousRange: emptySummary,
    trend: [], topProducts: [], lowProducts: [], alerts: [],
    stockProducts: { items: [], pagination: section.pagination },
    customerAnalysis: { items: [], pagination: section.pagination },
    invoices: section,
  };
  const links = evidence.buildProfitExplanationEvidence(data).evidenceLinks;
  assert.equal(links.find((link) => link.id === "invoice:pr-1")?.href, "/admin/purchase-returns/pr-1");
  assert.equal(links.find((link) => link.id === "invoice:dn-1")?.href, "/admin/supplier-debit-notes/dn-1");
});

const filters = { from: parseDateOnlyToDate("2026-09-01"), to: parseDateOnlyToEndOfDay("2026-09-30"),
  fromInput: "2026-09-01", toInput: "2026-09-30", customerCodeFrom: "", customerCodeTo: "", supplierCodeFrom: "",
  supplierCodeTo: "", productCodeFrom: "", productCodeTo: "", expenseCodeFrom: "", expenseCodeTo: "" };

test("P&L: the ลดราคาซื้อ variance (-120) joins the purchase cost variance inside cost of goods sold", { skip: moduleMocksUnavailable }, async () => {
  const data = await reports.getReportsData(filters);
  assert.equal(data.profitLoss.purchaseCostVariance, -120);
  assert.equal(data.profitLoss.costOfGoodsSold, -120);
  assert.equal(data.profitLoss.grossProfit, data.profitLoss.netRevenue + 120);
  const query = rawQueries.find((raw) => raw.sql.includes("PURCHASE_ALLOWANCE"));
  assert.ok(query?.sql.includes("'PURCHASE_COST_VARIANCE'"));
  assert.match(reports.buildReportsCsv(data), /ส่วนต่างต้นทุน DN \/ ลดราคาซื้อ \(รวมในต้นทุนด้านบน\)",?"?-120\.00/);
  allowanceTotal = null;
  assert.equal((await reports.getReportsData(filters)).profitLoss.purchaseCostVariance, 0);
});

test("P&L: a supplier filter keeps the ลดราคาซื้อ variance through the fact's supplier", { skip: moduleMocksUnavailable }, async () => {
  await reports.getReportsData({ ...filters, supplierCodeFrom: "S001", supplierCodeTo: "S001" });
  const query = rawQueries.find((raw) => raw.sql.includes("PURCHASE_ALLOWANCE"));
  assert.ok(query);
  // Nested Prisma.sql fragments arrive as values carrying their own text and bound parameters.
  const fragments = query.values.filter((value): value is { sql: string; values: unknown[] } =>
    typeof value === "object" && value !== null && "sql" in value && "values" in value);
  assert.ok(fragments.some((fragment) => fragment.sql.includes("JOIN \"Supplier\"")), fragments.map((f) => f.sql).join(" | "));
  assert.ok(fragments.some((fragment) => fragment.sql.includes("s.\"code\" >=") && fragment.values.includes("S001")),
    "the supplier code is a bound parameter");
});
