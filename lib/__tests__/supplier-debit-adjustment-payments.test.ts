import assert from "node:assert/strict";
import test, { before, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate } from "@/lib/th-date";

/**
 * ก3: the supplier credit of a negative "ปรับยอด DN" (parent 500 paid, -200 kept as SUPPLIER_CREDIT) is applied by the
 * next supplier payment. Paying a 1,000 purchase with it moves 800 in cash, and the payments report shows 800.
 */
const mocksUnavailable = typeof (mock as { module?: unknown }).module !== "function" && "requires module mocks";
const paymentDate = parseDateOnlyToDate("2026-09-30");
let reportQueries: typeof import("@/lib/report-queries");

before(async () => {
  if (mocksUnavailable) return;
  await mock.module("@/lib/db", { namedExports: { db: {
    supplierPayment: { findMany: async () => [{ paymentNo: "SP26090002", paymentDate, paymentMethod: "TRANSFER", note: null,
      status: "ACTIVE", cashBankAccount: { name: "KBank" }, supplier: { code: "S001", name: "Supplier A" },
      items: [
        { paidAmount: new Prisma.Decimal(1000), purchaseId: "po-1", debitNoteId: null, debitNote: null, purchaseReturnId: null, advanceId: null },
        { paidAmount: new Prisma.Decimal(200), purchaseId: null, debitNoteId: "adj-1", debitNote: { netAmount: new Prisma.Decimal(-200) },
          purchaseReturnId: null, advanceId: null },
      ] }] },
  } } });
  reportQueries = await import("@/lib/report-queries");
});

const line = (paidAmount: number, ref: { purchaseId?: string; debitNoteId?: string; debitNet?: number } = {}) => ({
  paidAmount, purchaseId: ref.purchaseId ?? null, debitNoteId: ref.debitNoteId ?? null,
  debitNote: ref.debitNet === undefined ? null : { netAmount: ref.debitNet },
});

test("a ปรับยอด DN credit line reduces cash out: purchase 1,000 - credit 200 = 800", { skip: mocksUnavailable }, () => {
  assert.equal(reportQueries.calculateSupplierPaymentCashOut([line(1000, { purchaseId: "po-1" }), line(200, { debitNoteId: "adj-1", debitNet: -200 })]), 800);
});

test("a DN payable line (positive net, e.g. a +100 adjustment) still adds to cash out", { skip: mocksUnavailable }, () => {
  assert.equal(reportQueries.calculateSupplierPaymentCashOut([line(100, { debitNoteId: "adj-2", debitNet: 100 })]), 100);
  assert.equal(reportQueries.isSupplierDebitCreditLine(line(100, { debitNoteId: "adj-2", debitNet: 100 })), false);
});

test("the daily payments report shows the 800 actually paid", { skip: mocksUnavailable }, async () => {
  const rows = await reportQueries.queryDailyPaymentRows({ from: paymentDate, to: paymentDate, fromStr: "2026-09-30", toStr: "2026-09-30",
    hasFilter: true, showCancelled: false, docType: "SUPPLIER_PAYMENT" });
  assert.deepEqual(rows.map((row) => [row.docNo, row.amount]), [["SP26090002", 800]]);
});
