import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate } from "@/lib/th-date";

/**
 * R10 (review 2026-11-12): the daily receipt and payment reports read their sections (cash sales,
 * receipts, advances, refunds … / purchases, expenses, supplier payments …) together instead of one
 * after another. The rows must come out exactly as before: the same rows, numbered in the same
 * order — including rows with the same date and document number in two sections, which the stable
 * sort leaves in the order the sections used to append them — whatever order the reads finish in.
 * The expected lists below are what the previous sequential code returned for this fixture.
 */
const mocksUnavailable = typeof (mock as { module?: unknown }).module !== "function" && "requires module mocks";
const D = (value: string): Prisma.Decimal => new Prisma.Decimal(value);
const DAY_1 = parseDateOnlyToDate("2026-11-03");
const DAY_2 = parseDateOnlyToDate("2026-11-04");
const supplier = { code: "S001", name: "ซัพพลายเออร์ ก" };
const account = { name: "KBank ร้าน", type: "BANK" };

type Where = Record<string, unknown>;
type FindManyArgs = { where: Where };

/** Section order of the previous code; each read is delayed so the later sections finish first. */
const SECTION_DELAY_MS: Record<string, number> = {
  sale: 60, receipt: 50, customerAdvance: 40, supplierAdvanceRefund: 30, purchaseReturn: 20, supplierDebitNote: 10,
  purchase: 60, expense: 50, supplierAdvance: 40, supplierPayment: 30, creditNote: 20, customerAdvanceRefund: 10,
};
const events: string[] = [];

const FIXTURE: Record<string, unknown[]> = {
  sale: [
    { saleNo: "DUP-1", saleDate: DAY_1, customerName: "ลูกค้า ก", paymentMethod: "CASH", netAmount: D("100.00"), note: null,
      status: "ACTIVE", cashBankAccount: { name: "เงินสด" }, customer: { code: "C001" } },
    { saleNo: "IV-2", saleDate: DAY_2, customerName: null, paymentMethod: "TRANSFER", netAmount: D("0.10"), note: "โอน",
      status: "ACTIVE", cashBankAccount: account, customer: null },
  ],
  receipt: [
    { receiptNo: "DUP-1", receiptDate: DAY_1, customerName: "ลูกค้า ข", paymentMethod: "TRANSFER", totalAmount: D("0.20"),
      note: null, status: "ACTIVE", cashBankAccount: account, customer: { code: "C002" } },
  ],
  customerAdvance: [
    { advanceNo: "CA-1", advanceDate: DAY_2, paymentMethod: "CASH", totalAmount: D("300.00"), note: "มัดจำ", status: "ACTIVE",
      cashBankAccount: null, customer: { code: null, name: "ลูกค้า ค" } },
  ],
  supplierAdvanceRefund: [
    { refundNo: "DUP-1", refundDate: DAY_1, refundAmount: D("55.55"), paymentMethod: "TRANSFER", note: null, status: "ACTIVE",
      cashBankAccount: account, supplierAdvance: { advanceNo: "SA-9", supplier } },
  ],
  purchaseReturn: [
    { returnNo: "PR-1", returnDate: DAY_1, refundMethod: "CASH", totalAmount: D("107.00"), note: null, status: "ACTIVE",
      cashBankAccount: null, supplier },
  ],
  supplierDebitNote: [
    { id: "adj-1", debitNo: "SDN-2", postingDate: DAY_2, refundMethod: "TRANSFER", note: null, status: "ACTIVE",
      cashBankAccount: account, supplier, adjustsDebitNote: { debitNo: "SDN-1" } },
  ],
  purchase: [
    { purchaseNo: "DUP-2", purchaseDate: DAY_2, netAmount: D("1070.00"), paymentMethod: "CASH", note: null, status: "ACTIVE",
      cashBankAccount: { name: "เงินสด" }, supplier },
  ],
  expense: [
    { expenseNo: "DUP-2", expenseDate: DAY_2, netAmount: D("214.00"), note: "ค่าส่ง", status: "ACTIVE", cashBankAccount: account,
      items: [{ expenseCode: { name: "ค่าขนส่ง" } }] },
    { expenseNo: "EX-1", expenseDate: DAY_1, netAmount: D("0.30"), note: null, status: "ACTIVE", cashBankAccount: null, items: [] },
  ],
  supplierAdvance: [
    { advanceNo: "SA-1", advanceDate: DAY_1, totalAmount: D("5000.00"), paymentMethod: "TRANSFER", note: null, status: "ACTIVE",
      cashBankAccount: account, supplier: null },
  ],
  supplierPayment: [
    { paymentNo: "DUP-2", paymentDate: DAY_2, paymentMethod: "CASH", note: null, status: "ACTIVE", cashBankAccount: null, supplier,
      items: [{ paidAmount: D("700.00"), purchaseId: "pu-1", debitNoteId: null, debitNote: null, purchaseReturnId: null, advanceId: null },
        { paidAmount: D("100.00"), purchaseId: null, debitNoteId: null, debitNote: null, purchaseReturnId: "pr-1", advanceId: null }] },
  ],
  creditNote: [
    { cnNo: "CN-1", cnDate: DAY_1, totalAmount: D("53.50"), refundMethod: "TRANSFER", customerName: "ลูกค้า ก", note: null,
      status: "ACTIVE", cashBankAccount: account, customer: { code: "C001" } },
  ],
  customerAdvanceRefund: [
    { refundNo: "DUP-2", refundDate: DAY_2, refundAmount: D("25.00"), paymentMethod: "CASH", note: "คืนมัดจำ", status: "ACTIVE",
      cashBankAccount: null, customerAdvance: { advanceNo: "CA-1", customer: { code: "C003", name: "ลูกค้า ค" } } },
  ],
};

const EXPECTED_RECEIPTS: Array<[string, string, number]> = [
  ["CASH_SALE", "DUP-1", 100], ["RECEIPT", "DUP-1", 0.2], ["SUPPLIER_ADVANCE_REFUND", "DUP-1", 55.55],
  ["PURCHASE_RETURN", "PR-1", 107], ["CUSTOMER_ADVANCE", "CA-1", 300], ["CASH_SALE", "IV-2", 0.1],
  ["SUPPLIER_DEBIT_REFUND", "SDN-2", 150.05],
];
const EXPECTED_PAYMENTS: Array<[string, string, number]> = [
  ["คืนเงินลูกค้า", "CN-1", 53.5], ["ค่าใช้จ่าย", "EX-1", 0.3], ["เงินมัดจำซัพพลายเออร์", "SA-1", 5000],
  ["ซื้อสินค้า", "DUP-2", 1070], ["ค่าใช้จ่าย", "DUP-2", 214], ["จ่ายชำระซัพพลายเออร์", "DUP-2", 600],
  ["คืนเงินมัดจำลูกค้า", "DUP-2", 25],
];

let queries: typeof import("@/lib/report-queries");

before(async () => {
  if (mocksUnavailable) return;
  const model = (name: string) => ({
    findMany: async (): Promise<unknown[]> => {
      events.push(`start:${name}`);
      await new Promise((resolve) => setTimeout(resolve, SECTION_DELAY_MS[name] ?? 0));
      events.push(`end:${name}`);
      return FIXTURE[name] ?? [];
    },
  });
  const db: Record<string, unknown> = Object.fromEntries(Object.keys(FIXTURE).map((name) => [name, model(name)]));
  db.documentPayment = {
    findMany: async (args: FindManyArgs) => ("cashBankAccountId" in args.where
      ? [{ docId: "split-doc" }]
      : [{ docId: "adj-1", amount: D("100.10") }, { docId: "adj-1", amount: D("49.95") }]),
  };
  await mock.module("@/lib/db", { namedExports: { db } });
  queries = await import("@/lib/report-queries");
});

beforeEach(() => {
  events.length = 0;
});

const filtersFor = (params: Record<string, string | undefined> = {}) =>
  queries.parseReportQueryFilters({ from: "2026-11-01", to: "2026-11-30", ...params });

test("daily receipts: same rows and order as the sequential reads, all sections read together", { skip: mocksUnavailable }, async () => {
  const rows = await queries.queryDailyReceiptRows(filtersFor());
  assert.deepEqual(rows.map((row) => [row.source, row.docNo, row.amount]), EXPECTED_RECEIPTS);
  assert.deepEqual(rows.map((row) => row.rowNo), [1, 2, 3, 4, 5, 6, 7]);
  const firstEnd = events.findIndex((event) => event.startsWith("end:"));
  assert.equal(events.slice(0, firstEnd).filter((event) => event.startsWith("start:")).length, 6, "every section starts before one ends");
});

test("daily payments: same rows and order as the sequential reads, all sections read together", { skip: mocksUnavailable }, async () => {
  const rows = await queries.queryDailyPaymentRows(filtersFor());
  assert.deepEqual(rows.map((row) => [row.docType, row.docNo, row.amount]), EXPECTED_PAYMENTS);
  assert.deepEqual(rows.map((row) => row.rowNo), [1, 2, 3, 4, 5, 6, 7]);
  const firstEnd = events.findIndex((event) => event.startsWith("end:"));
  assert.equal(events.slice(0, firstEnd).filter((event) => event.startsWith("start:")).length, 6, "every section starts before one ends");
});

test("a docType filter still reads only that section", { skip: mocksUnavailable }, async () => {
  const receipts = await queries.queryDailyReceiptRows(filtersFor({ docType: "RECEIPT", accountId: "bank-1" }));
  assert.deepEqual(receipts.map((row) => row.docNo), ["DUP-1"]);
  assert.deepEqual(events, ["start:receipt", "end:receipt"]);
  events.length = 0;
  const payments = await queries.queryDailyPaymentRows(filtersFor({ docType: "CUSTOMER_ADVANCE_REFUND" }));
  assert.deepEqual(payments.map((row) => row.docNo), ["DUP-2"]);
  assert.deepEqual(events, ["start:customerAdvanceRefund", "end:customerAdvanceRefund"]);
});
