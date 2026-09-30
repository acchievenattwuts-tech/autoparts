import assert from "node:assert/strict";
import test, { before, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate, parseDateOnlyToEndOfDay } from "@/lib/th-date";

/**
 * Reports with a "ปรับยอด DN" (R5-D / ก3): parent SDN26080001 500 fully paid; SDN26090002 -200 kept as supplier credit
 * (amountRemain -200, variance -120); SDN26090003 +100 unpaid. Credits reduce AP totals; the per-supplier DN column and
 * P&L variance net the signed amounts.
 */
const mocksUnavailable = typeof (mock as { module?: unknown }).module !== "function" && "requires module mocks";
const D = (value: number): Prisma.Decimal => new Prisma.Decimal(value);
const received = parseDateOnlyToDate("2026-09-30");
const from = parseDateOnlyToDate("2026-09-01");
const to = parseDateOnlyToEndOfDay("2026-09-30");
const base = { supplierId: "sup-1", supplier: { name: "Supplier A", code: "S001" }, receivedDate: received, postingDate: received,
  dueDate: received, status: "ACTIVE", vatAmount: D(0), vatRecoverable: false };
const debits = [
  { ...base, id: "dn", debitNo: "SDN26080001", netAmount: D(500), amountRemain: D(0), varianceAmount: D(300), adjustsDebitNote: null },
  { ...base, id: "adj-1", debitNo: "SDN26090002", netAmount: D(-200), amountRemain: D(-200), varianceAmount: D(-120),
    adjustsDebitNote: { debitNo: "SDN26080001" } },
  { ...base, id: "adj-2", debitNo: "SDN26090003", netAmount: D(100), amountRemain: D(100), varianceAmount: D(60),
    adjustsDebitNote: { debitNo: "SDN26080001" } },
];
const matchesRemain = (where: Record<string, unknown>, value: number): boolean => {
  const rule = where.amountRemain as { gt?: number; not?: number } | undefined;
  return !rule || (rule.gt === undefined || value > rule.gt) && (rule.not === undefined || value !== rule.not);
};

let apModule: typeof import("@/lib/ar-ap-stock-report-queries");
let registerModule: typeof import("@/lib/ar-ap-register-queries");
let reports: typeof import("@/lib/reports");

before(async () => {
  if (mocksUnavailable) return;
  const emptyModel = { findMany: async () => [], aggregate: async () => ({ _sum: {} }) };
  const models: Record<string, unknown> = {
    $queryRaw: async () => [],
    supplierDebitNote: { findMany: async (args: { where: Record<string, unknown> }) =>
      debits.filter((row) => matchesRemain(args.where, Number(row.amountRemain))) },
  };
  const db = new Proxy(models, { get: (target, key: string) => target[key] ?? emptyModel });
  await mock.module("@/lib/db", { namedExports: { db } });
  apModule = await import("@/lib/ar-ap-stock-report-queries");
  registerModule = await import("@/lib/ar-ap-register-queries");
  reports = await import("@/lib/reports");
});

test("AP balance: the +100 adjustment is a payable labelled with its DN, the 200 credit sits with the credits", { skip: mocksUnavailable }, async () => {
  const data = await apModule.queryAPData(apModule.parseARAPStockFilters({ from: "2026-09-01", to: "2026-09-30" }));
  assert.deepEqual(data.purchases.map((row) => [row.purchaseNo, row.amountRemain, row.label]), [["SDN26090003", 100, "ปรับยอดจาก DN SDN26080001"]]);
  assert.deepEqual(data.cnCredits.map((row) => [row.kind, row.returnNo, row.totalAmount, row.amountRemain, row.label]),
    [["SUPPLIER_DEBIT", "SDN26090002", 200, 200, "ปรับยอดจาก DN SDN26080001"]]);
  assert.match(apModule.buildAPCsv(data), /SDN26090002,[^\r\n]*,200,200,ปรับยอดจาก DN SDN26080001/);
});

test("AP register: signed rows keep the totals honest (net 400, paid 500, remain -100)", { skip: mocksUnavailable }, async () => {
  const rows = await registerModule.queryAPRegisterRows(apModule.parseARAPStockFilters({ from: "2026-09-01", to: "2026-09-30" }));
  const credit = rows.find((row) => row.docNo === "SDN26090002");
  assert.deepEqual(credit && [credit.rowType, credit.typeLabel, credit.netAmount, credit.paidAmount, credit.amountRemain, credit.status],
    ["SUPPLIER_DEBIT_ADJUSTMENT", "ปรับยอดจาก DN SDN26080001", -200, 0, -200, "UNPAID"]);
  const plus = rows.find((row) => row.docNo === "SDN26090003");
  assert.deepEqual(plus && [plus.rowType, plus.netAmount, plus.amountRemain], ["SUPPLIER_DEBIT_ADJUSTMENT", 100, 100]);
  const summary = registerModule.summarizeAPRegister(rows);
  assert.deepEqual([summary.totalNet, summary.totalPaid, summary.totalRemain], [400, 500, -100]);
  assert.match(registerModule.buildAPRegisterCsv(rows), /SDN26090002,[^\r\n]*,ปรับยอดจาก DN SDN26080001,-200,0,-200/);
});

test("management report: debitOutstanding nets the credit (100 - 200 = -100); DN column and variance net the adjustments", { skip: mocksUnavailable }, async () => {
  const data = await reports.getReportsData({ from, to, fromInput: "2026-09-01", toInput: "2026-09-30",
    customerCodeFrom: "", customerCodeTo: "", supplierCodeFrom: "", supplierCodeTo: "",
    productCodeFrom: "", productCodeTo: "", expenseCodeFrom: "", expenseCodeTo: "" });
  assert.equal(data.payables.debitOutstanding, -100);
  assert.equal(data.suppliers.totalDebitAmount, 400);
  assert.equal(data.suppliers.items[0].debitAmount, 400);
  assert.equal(data.profitLoss.purchaseCostVariance, 240);
});
