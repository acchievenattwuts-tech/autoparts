import assert from "node:assert/strict";
import test, { before, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate, parseDateOnlyToEndOfDay } from "@/lib/th-date";

// Management report (lib/reports.ts):
// - D16: with a product filter, DN purchase cost variance sums only the matching
//   lines (DN with A=300, B=100 filtered to A → 300, not the 400 header).
// - D6: payables.debitOutstanding carries open DN balances received in the period.

const mocksUnavailable = typeof (mock as { module?: unknown }).module !== "function" && "requires module mocks";
type FindManyArgs = { where: Record<string, unknown>; select: Record<string, unknown> };
const varianceArgs: FindManyArgs[] = [];
const outstandingArgs: FindManyArgs[] = [];
const from = parseDateOnlyToDate("2026-09-01");
const to = parseDateOnlyToEndOfDay("2026-09-30");

let reports: typeof import("@/lib/reports");

before(async () => {
  if (mocksUnavailable) return;
  const emptyModel = { findMany: async () => [] };
  const models: Record<string, unknown> = {
    $queryRaw: async () => [],
    supplierDebitNote: { findMany: async (args: FindManyArgs) => {
      if (args.select.varianceAmount) {
        varianceArgs.push(args);
        // Header variance 400 = line A 300 + line B 100; the DB returns only line A
        // when the select carries the product filter.
        return [{ varianceAmount: new Prisma.Decimal(400), vatAmount: new Prisma.Decimal(0), vatRecoverable: true,
          ...(args.select.items ? { items: [{ varianceAmount: new Prisma.Decimal(300) }] } : {}) }];
      }
      outstandingArgs.push(args);
      return [{ amountRemain: new Prisma.Decimal(375) }];
    } },
  };
  const db = new Proxy(models, { get: (target, key: string) => target[key] ?? emptyModel });
  await mock.module("@/lib/db", { namedExports: { db } });
  reports = await import("@/lib/reports");
});

const baseFilters = { from, to, fromInput: "2026-09-01", toInput: "2026-09-30",
  customerCodeFrom: "", customerCodeTo: "", supplierCodeFrom: "", supplierCodeTo: "",
  productCodeFrom: "", productCodeTo: "", expenseCodeFrom: "", expenseCodeTo: "" };

test("sumSupplierDebitVariance uses the header without a product filter and matching lines with one", () => {
  const debits = [{ varianceAmount: 400, items: [{ varianceAmount: 300 }] }, { varianceAmount: 50, items: [] }];
  assert.equal(reports.sumSupplierDebitVariance(debits, false), 450);
  assert.equal(reports.sumSupplierDebitVariance(debits, true), 300);
});

test("product filter: P&L variance sums only the matching DN lines", { skip: mocksUnavailable }, async () => {
  varianceArgs.length = 0;
  const data = await reports.getReportsData({ ...baseFilters, productCodeFrom: "A001", productCodeTo: "A001" });
  assert.deepEqual(varianceArgs[0].select.items, {
    where: { product: { code: { gte: "A001", lte: "A001" } } },
    select: { varianceAmount: true },
  });
  assert.equal(data.profitLoss.purchaseCostVariance, 300);
});

test("no product filter: P&L variance keeps the DN header total and loads no lines", { skip: mocksUnavailable }, async () => {
  varianceArgs.length = 0;
  const data = await reports.getReportsData(baseFilters);
  assert.equal(varianceArgs[0].select.items, false);
  assert.equal(data.profitLoss.purchaseCostVariance, 400);
});

test("supplier filter alone keeps whole-DN (header) variance for that supplier's DNs", { skip: mocksUnavailable }, async () => {
  varianceArgs.length = 0;
  const data = await reports.getReportsData({ ...baseFilters, supplierCodeFrom: "S001", supplierCodeTo: "S001" });
  assert.deepEqual(varianceArgs[0].where.supplier, { code: { gte: "S001", lte: "S001" } });
  assert.equal(varianceArgs[0].select.items, false);
  assert.equal(data.profitLoss.purchaseCostVariance, 400);
});

test("payables.debitOutstanding sums open active DNs received in the period, apart from purchases", { skip: mocksUnavailable }, async () => {
  outstandingArgs.length = 0;
  const data = await reports.getReportsData(baseFilters);
  // Non-zero, not only positive: a ปรับยอด DN supplier credit is stored as a negative amountRemain and reduces it (ก3).
  assert.deepEqual(outstandingArgs[0].where, {
    status: "ACTIVE", amountRemain: { not: 0 }, receivedDate: { gte: from, lte: to },
  });
  assert.equal(data.payables.debitOutstanding, 375);
  assert.equal(data.payables.purchaseOutstanding, 0);
});
