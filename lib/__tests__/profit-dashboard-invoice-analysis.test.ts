import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

import type { ProfitDashboardData, ProfitSummary } from "@/lib/profit-dashboard";
import { parseDateOnlyToDate } from "@/lib/th-date";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type FakeFact = {
  isActive: boolean;
  sourceType: "SALE" | "SALE_RETURN" | "PURCHASE_COST_VARIANCE" | "EXPENSE";
  sourceId: string;
  sourceLineId: string;
  sourceDocNo: string;
  businessDate: Date;
  customerName: string | null;
  supplierName: string | null;
  salesAmountExVat: number;
  salesAmountIncVat: number;
  costAmount: number;
  grossProfit: number;
};

type GroupByArgs = {
  by: Array<keyof FakeFact>;
  where: {
    isActive: boolean;
    sourceType: { in: string[] };
    businessDate: { gte: Date; lte: Date };
  };
  _sum?: Partial<Record<keyof FakeFact, true>>;
  orderBy?: unknown;
  skip?: number;
  take?: number;
};

type FindManyArgs = { where: { id: { in: string[] } }; select: unknown };

const businessDate = parseDateOnlyToDate("2026-09-15");
const sale = { sourceType: "SALE", sourceId: "sale-1", sourceDocNo: "IV202609150001", businessDate,
  customerName: "ลูกค้าทดสอบ", isActive: true } as const;
const facts: FakeFact[] = [
  { ...sale, sourceLineId: "line-1", supplierName: "Supplier A",
    salesAmountExVat: 600, salesAmountIncVat: 642, costAmount: 400, grossProfit: 200 },
  { ...sale, sourceLineId: "line-2", supplierName: "Supplier B",
    salesAmountExVat: 300, salesAmountIncVat: 321, costAmount: 250, grossProfit: 50 },
  { ...sale, sourceLineId: "sale-1:shipping", supplierName: null,
    salesAmountExVat: 50, salesAmountIncVat: 53.5, costAmount: 0, grossProfit: 50 },
  { isActive: true, sourceType: "PURCHASE_COST_VARIANCE", sourceId: "dn-1", sourceLineId: "dn-line-1",
    sourceDocNo: "SDN202609150001", businessDate, customerName: null, supplierName: "Supplier DN (snapshot)",
    salesAmountExVat: 0, salesAmountIncVat: 0, costAmount: 30, grossProfit: -30 },
  { isActive: true, sourceType: "PURCHASE_COST_VARIANCE", sourceId: "dn-1", sourceLineId: "dn-line-2",
    sourceDocNo: "SDN202609150001", businessDate, customerName: null, supplierName: "Supplier DN (snapshot)",
    salesAmountExVat: 0, salesAmountIncVat: 0, costAmount: 20, grossProfit: -20 },
];

const debitNoteFindManyCalls: FindManyArgs[] = [];

function fakeGroupBy(args: GroupByArgs): Array<Record<string, unknown>> {
  const matching = facts.filter((fact) =>
    fact.isActive === args.where.isActive &&
    args.where.sourceType.in.includes(fact.sourceType) &&
    fact.businessDate >= args.where.businessDate.gte &&
    fact.businessDate <= args.where.businessDate.lte);
  const groups = new Map<string, Record<string, unknown> & { _sum: Record<string, number> }>();
  for (const fact of matching) {
    const key = JSON.stringify(args.by.map((field) => fact[field]));
    const group = groups.get(key) ??
      { ...Object.fromEntries(args.by.map((field) => [field, fact[field]])), _sum: {} };
    for (const field of Object.keys(args._sum ?? {}) as Array<keyof FakeFact>) {
      group._sum[field] = (group._sum[field] ?? 0) + Number(fact[field]);
    }
    groups.set(key, group);
  }
  const rows = [...groups.values()].sort((left, right) =>
    (right._sum.grossProfit ?? 0) - (left._sum.grossProfit ?? 0));
  const skip = args.skip ?? 0;
  return rows.slice(skip, args.take === undefined ? undefined : skip + args.take);
}

let dashboard: typeof import("@/lib/profit-dashboard");
let evidence: typeof import("@/lib/profit-explanation/evidence");

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("next/cache", {
    namedExports: {
      unstable_cache: <Args extends unknown[], Result>(
        callback: (...args: Args) => Promise<Result>,
      ): ((...args: Args) => Promise<Result>) => callback,
      revalidateTag: (): void => undefined,
    },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      withDbRetry: <T>(operation: () => Promise<T>): Promise<T> => operation(),
      db: {
        factProfit: { groupBy: async (args: GroupByArgs) => fakeGroupBy(args) },
        supplierDebitNote: {
          findMany: async (args: FindManyArgs) => {
            debitNoteFindManyCalls.push(args);
            return args.where.id.in
              .filter((id) => id === "dn-1")
              .map((id) => ({ id, supplier: { name: "Supplier DN" } }));
          },
        },
      },
    },
  });
  dashboard = await import("@/lib/profit-dashboard");
  evidence = await import("@/lib/profit-explanation/evidence");
});

const emptySummary: ProfitSummary = { salesAmountExVat: 0, salesAmountIncVat: 0, costAmount: 0,
  expenseAmount: 0, grossProfit: 0, netProfitAmount: 0, marginPct: 0 };

test(
  "invoice analysis keeps one row per document for a mixed-supplier sale with shipping and a DN",
  { skip: moduleMocksUnavailable },
  async () => {
    debitNoteFindManyCalls.length = 0;
    const section = await dashboard.getProfitInvoiceSection({ from: "2026-09-01", to: "2026-09-30", page: 1 });

    assert.equal(section.pagination.totalItems, 2);
    assert.equal(section.items.length, 2);
    const keys = section.items.map((row) => `${row.sourceType}-${row.sourceId}`);
    assert.equal(new Set(keys).size, keys.length, "React keys must be unique");

    const saleRow = section.items.find((row) => row.sourceId === "sale-1");
    assert.ok(saleRow);
    assert.equal(saleRow.sourceDocNo, "IV202609150001");
    assert.equal(saleRow.customerName, "ลูกค้าทดสอบ");
    assert.equal(saleRow.salesAmountExVat, 950);
    assert.equal(saleRow.salesAmountIncVat, 1016.5);
    assert.equal(saleRow.costAmount, 650);
    assert.equal(saleRow.grossProfit, 300);

    const debitRow = section.items.find((row) => row.sourceId === "dn-1");
    assert.ok(debitRow);
    assert.equal(debitRow.customerName, "Supplier DN");
    assert.equal(debitRow.costAmount, 50);
    assert.equal(debitRow.grossProfit, -50);

    assert.equal(debitNoteFindManyCalls.length, 1, "supplier names come from one DN query");
    assert.deepEqual(debitNoteFindManyCalls[0].where, { id: { in: ["dn-1"] } });

    const data: ProfitDashboardData = {
      filters: { from: "2026-09-01", to: "2026-09-30", basis: "ex_vat" },
      today: emptySummary, yesterday: emptySummary, selectedRange: emptySummary, previousRange: emptySummary,
      trend: [], topProducts: [], lowProducts: [], alerts: [],
      stockProducts: { items: [], pagination: section.pagination },
      customerAnalysis: { items: [], pagination: section.pagination },
      invoices: section,
    };
    const invoiceIds = evidence.buildProfitExplanationEvidence(data).evidenceLinks
      .map((link) => link.id)
      .filter((id) => id.startsWith("invoice:"));
    assert.deepEqual(invoiceIds.toSorted(), ["invoice:dn-1", "invoice:sale-1"]);
  },
);
