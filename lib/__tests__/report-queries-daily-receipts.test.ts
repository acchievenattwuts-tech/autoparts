import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { before, beforeEach, mock } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate } from "@/lib/th-date";

// Owner decision S6: the daily receipts report /admin/reports/receipts (queryDailyReceiptRows, and
// its CSV / Excel "รับเงินประจำวัน" exports built from the same rows) also lists money a supplier
// paid back: purchase-return cash refunds and ปรับยอด DN cash refunds (cash/bank source
// SUPPLIER_DEBIT_REFUND), with the refunded amount, and counts them in the totals.

type Where = Record<string, unknown>;
type FindManyArgs = { where: Where };

const mocksUnavailable = typeof (mock as { module?: unknown }).module !== "function" && "requires module mocks";
const D = (value: string): Prisma.Decimal => new Prisma.Decimal(value);
const SALE_DATE = parseDateOnlyToDate("2026-09-17");
const RETURN_DATE = parseDateOnlyToDate("2026-09-18");
const POSTING_DATE = parseDateOnlyToDate("2026-09-20");
const supplier = { code: "S001", name: "Supplier A" };

const cashSale = {
  saleNo: "SA26090001", saleDate: SALE_DATE, customerName: "ลูกค้าหน้าร้าน", paymentMethod: "CASH", netAmount: D("500.00"),
  note: null, status: "ACTIVE", cashBankAccount: { name: "เงินสดหน้าร้าน" }, customer: { code: "C001" },
};
const purchaseReturns = [
  { returnNo: "PR26090001", returnDate: RETURN_DATE, refundMethod: "TRANSFER", totalAmount: D("107.00"), note: "คืนของเสีย",
    status: "ACTIVE", cashBankAccount: { name: "KBank ร้าน" }, supplier },
  { returnNo: "PR26090002", returnDate: RETURN_DATE, refundMethod: "CASH", totalAmount: D("40.00"), note: null,
    status: "CANCELLED", cashBankAccount: null, supplier: null },
];
const adjustment = (id: string, debitNo: string) => ({
  id, debitNo, postingDate: POSTING_DATE, refundMethod: "TRANSFER", note: "ซัพพลายเออร์โอนคืน", status: "ACTIVE",
  cashBankAccount: { name: "KBank ร้าน" }, supplier, adjustsDebitNote: { debitNo: "SDN26080001" },
});
// SDN26090002 came back as two refund rows (100.10 + 49.95); SDN26090004 has none and is not money in.
const adjustments = [adjustment("adj-1", "SDN26090002"), adjustment("adj-2", "SDN26090004")];
const refundPayments = [
  { docId: "adj-1", amount: D("100.10") },
  { docId: "adj-1", amount: D("49.95") },
];

const calls: Record<string, Where[]> = {};
const record = (model: string, args: FindManyArgs): void => {
  (calls[model] ??= []).push(args.where);
};

let queries: typeof import("@/lib/report-queries");
let results: typeof import("@/app/admin/(protected)/reports/receipts/ReceiptsReportResults");

before(async () => {
  if (mocksUnavailable) return;
  const listOf = (model: string, rows: (args: FindManyArgs) => unknown[]) => ({
    findMany: async (args: FindManyArgs) => {
      record(model, args);
      return rows(args);
    },
  });
  const statusOf = (args: FindManyArgs): unknown => args.where.status;
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        sale: listOf("sale", () => [cashSale]),
        receipt: listOf("receipt", () => []),
        customerAdvance: listOf("customerAdvance", () => []),
        supplierAdvanceRefund: listOf("supplierAdvanceRefund", () => []),
        purchaseReturn: listOf("purchaseReturn", (args) =>
          purchaseReturns.filter((row) => statusOf(args) === undefined || row.status === statusOf(args))),
        supplierDebitNote: listOf("supplierDebitNote", () => adjustments),
        documentPayment: listOf("documentPayment", (args) =>
          "cashBankAccountId" in args.where ? [{ docId: "split-doc" }] : refundPayments),
      },
    },
  });
  queries = await import("@/lib/report-queries");
  results = await import("@/app/admin/(protected)/reports/receipts/ReceiptsReportResults");
});

beforeEach(() => {
  for (const key of Object.keys(calls)) delete calls[key];
});

const filtersFor = (params: Record<string, string | undefined> = {}) =>
  queries.parseReportQueryFilters({ from: "2026-09-01", to: "2026-09-30", ...params });

test("supplier refunds are listed with number, label, supplier, account and the refunded amount", { skip: mocksUnavailable }, async () => {
  const rows = await queries.queryDailyReceiptRows(filtersFor());
  assert.deepEqual(
    rows.map((row) => [row.rowNo, row.source, row.docNo, row.docType, row.customerCode, row.customerName,
      row.paymentMethod, row.accountName, row.note, row.status, row.amount]),
    [
      [1, "CASH_SALE", "SA26090001", "ขายสด", "C001", "ลูกค้าหน้าร้าน", "เงินสด", "เงินสดหน้าร้าน", "", "ACTIVE", 500],
      [2, "PURCHASE_RETURN", "PR26090001", "รับเงินคืนจากใบคืนซื้อ", "S001", "Supplier A", "โอนเงิน", "KBank ร้าน", "คืนของเสีย", "ACTIVE", 107],
      [3, "SUPPLIER_DEBIT_REFUND", "SDN26090002", "รับเงินคืนจากปรับยอด DN SDN26080001", "S001", "Supplier A", "โอนเงิน",
        "KBank ร้าน", "ซัพพลายเออร์โอนคืน", "ACTIVE", 150.05],
    ],
  );

  assert.deepEqual(calls.purchaseReturn, [{
    returnDate: { gte: parseDateOnlyToDate("2026-09-01"), lte: filtersFor().to },
    settlementType: "CASH_REFUND",
    status: "ACTIVE",
  }]);
  assert.deepEqual(calls.supplierDebitNote, [{
    status: "ACTIVE",
    adjustsDebitNoteId: { not: null },
    excessSettlementType: "CASH_REFUND",
    postingDate: { gte: parseDateOnlyToDate("2026-09-01"), lte: filtersFor().to },
  }]);
  assert.deepEqual(calls.documentPayment, [{ docType: "SUPPLIER_DEBIT_REFUND", docId: { in: ["adj-1", "adj-2"] } }]);
});

test("the totals count every ACTIVE supplier refund; the cards show both kinds in light and dark", { skip: mocksUnavailable }, async () => {
  const rows = await queries.queryDailyReceiptRows(filtersFor({ showCancelled: "1" }));
  assert.ok(rows.some((row) => row.docNo === "PR26090002" && row.status === "CANCELLED"), "a cancelled return is shown");
  const totals = results.buildReceiptSummaryTotals(rows);
  assert.deepEqual(totals, {
    total: 757.05,
    cashSale: 500,
    receipt: 0,
    customerAdvance: 0,
    supplierAdvanceRefund: 0,
    purchaseReturnRefund: 107,
    supplierDebitRefund: 150.05,
  });
  const html = renderToStaticMarkup(createElement(results.ReceiptSummaryCards, { totals }));
  assert.match(html, /รับเงินคืนจากใบคืนซื้อ<\/p><p class="[^"]*dark:text-violet-300[^"]*">107\.00/);
  assert.match(html, /รับเงินคืนจากปรับยอด DN<\/p><p class="[^"]*dark:text-teal-300[^"]*">150\.05/);
  assert.match(html, /757\.05/);
});

test("the docType filter narrows to one kind, and a cancelled DN adjustment is never listed", { skip: mocksUnavailable }, async () => {
  const returnsOnly = await queries.queryDailyReceiptRows(filtersFor({ docType: "PURCHASE_RETURN", showCancelled: "1" }));
  assert.deepEqual(returnsOnly.map((row) => row.docNo), ["PR26090001", "PR26090002"]);
  assert.deepEqual(Object.keys(calls), ["purchaseReturn"], "no other source is queried");
  assert.equal(calls.purchaseReturn?.[0]?.status, undefined, "showCancelled includes cancelled returns");

  const debitsOnly = await queries.queryDailyReceiptRows(filtersFor({ docType: "SUPPLIER_DEBIT_REFUND", showCancelled: "1" }));
  assert.deepEqual(debitsOnly.map((row) => row.docNo), ["SDN26090002"]);
  // Cancelling an adjustment clears its refund rows, so only ACTIVE ones carry a refunded amount.
  assert.equal(calls.supplierDebitNote?.[0]?.status, "ACTIVE");
});

test("the account filter also matches split refund rows on that account", { skip: mocksUnavailable }, async () => {
  await queries.queryDailyReceiptRows(filtersFor({ docType: "PURCHASE_RETURN", accountId: "bank-1" }));
  await queries.queryDailyReceiptRows(filtersFor({ docType: "SUPPLIER_DEBIT_REFUND", accountId: "bank-1" }));
  assert.deepEqual(calls.documentPayment?.slice(0, 2), [
    { docType: "CN_PURCHASE", cashBankAccountId: "bank-1" },
    { docType: "SUPPLIER_DEBIT_REFUND", cashBankAccountId: "bank-1" },
  ]);
  const accountFilter = { OR: [{ cashBankAccountId: "bank-1" }, { id: { in: ["split-doc"] } }] };
  assert.deepEqual(calls.purchaseReturn?.[0]?.OR, accountFilter.OR);
  assert.deepEqual(calls.supplierDebitNote?.[0]?.OR, accountFilter.OR);
});

test("the CSV export carries the supplier refund rows; page and exports stay on AdminExportLink", { skip: mocksUnavailable }, async () => {
  const csv = queries.buildDailyReceiptCsv(await queries.queryDailyReceiptRows(filtersFor()));
  assert.ok(csv.startsWith("﻿"), "UTF-8 BOM for Excel");
  assert.match(csv, /PR26090001,.*รับเงินคืนจากใบคืนซื้อ,S001,Supplier A,โอนเงิน,KBank ร้าน,คืนของเสีย,ปกติ,107/);
  assert.match(csv, /SDN26090002,.*รับเงินคืนจากปรับยอด DN SDN26080001,S001,Supplier A,โอนเงิน,KBank ร้าน,ซัพพลายเออร์โอนคืน,ปกติ,150\.05/);

  const page = readFileSync(join(process.cwd(), "app/admin/(protected)/reports/receipts/page.tsx"), "utf8");
  assert.match(page, /<option value="PURCHASE_RETURN">\{PURCHASE_RETURN_REFUND_RECEIPT_LABEL\}<\/option>/);
  assert.match(page, /<option value="SUPPLIER_DEBIT_REFUND">\{SUPPLIER_DEBIT_REFUND_RECEIPT_LABEL\}<\/option>/);
  assert.equal(page.match(/<AdminExportLink\b/g)?.length, 2);
  assert.match(page, /href=\{`\/admin\/reports\/export\?type=daily-receipt&\$\{exportQuery\}`\}/);
  assert.match(page, /href=\{`\/admin\/reports\/export-excel\?type=daily-receipt&\$\{exportQuery\}`\}/);
});
