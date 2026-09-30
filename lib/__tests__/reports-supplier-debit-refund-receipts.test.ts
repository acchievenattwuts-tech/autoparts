import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate, parseDateOnlyToEndOfDay } from "@/lib/th-date";

// P9 (lib/reports.ts, "รายงานรับเงินประจำวัน"): cash a supplier paid back on a ปรับยอด DN (CASH_REFUND,
// cash/bank source SUPPLIER_DEBIT_REFUND) is listed with the daily receipts like a purchase-return cash refund:
// the refunded amount, the adjustment's number labelled "ปรับยอดจาก DN <parent>", its account and supplier.

type Where = Record<string, unknown>;
const mocksUnavailable = typeof (mock as { module?: unknown }).module !== "function" && "requires module mocks";
const from = parseDateOnlyToDate("2026-09-01");
const to = parseDateOnlyToEndOfDay("2026-09-30");
const refundDate = parseDateOnlyToDate("2026-09-20");
const returnDate = parseDateOnlyToDate("2026-09-18");
const D = (value: number): Prisma.Decimal => new Prisma.Decimal(value);
const supplier = { code: "S001", name: "Supplier A" };

const purchaseReturn = { id: "pr-1", returnNo: "PR26090001", returnDate, supplierId: "sup-1", supplier, totalAmount: D(107),
  amountRemain: D(0), settlementType: "CASH_REFUND", refundMethod: "CASH", note: null, cashBankAccount: { name: "เงินสดหน้าร้าน" } };
const refundAdjustment = (id: string, debitNo: string) => ({ id, debitNo, postingDate: refundDate, excessSettlementType: "CASH_REFUND",
  refundMethod: "TRANSFER", note: "ซัพพลายเออร์โอนคืน", cashBankAccount: { name: "KBank ร้าน" }, supplier,
  adjustsDebitNote: { debitNo: "SDN26080001" } });
// SDN26090002 reduced the parent by 200: 50 went to the parent's open balance and 150 came back as cash.
// SDN26090004 has no refund row (for example a partial data repair) and must not be listed as money in.
const adjustments = [refundAdjustment("adj-1", "SDN26090002"), refundAdjustment("adj-2", "SDN26090004")];
const refundPayments = [{ docType: "SUPPLIER_DEBIT_REFUND", docId: "adj-1", amount: D(150) }];

let refundWhere: Where[] = [];
let paymentWhere: Where[] = [];
let reports: typeof import("@/lib/reports");
let ReportsContent: typeof import("@/app/admin/(protected)/reports/ReportsContent").default;

before(async () => {
  if (mocksUnavailable) return;
  const emptyModel = { findMany: async () => [] };
  const models: Record<string, unknown> = {
    $queryRaw: async () => [],
    purchaseReturn: { findMany: async () => [purchaseReturn] },
    // Only the refund query asks for CASH_REFUND adjustments; the P&L / AP DN queries get nothing here.
    supplierDebitNote: { findMany: async ({ where }: { where: Where }) => {
      if (where.excessSettlementType !== "CASH_REFUND") return [];
      refundWhere.push(where);
      return (where.supplier as { code?: { gte?: string } } | undefined)?.code?.gte === "S999" ? [] : adjustments;
    } },
    documentPayment: { findMany: async ({ where }: { where: { docType: string; docId: { in: string[] } } }) => {
      paymentWhere.push(where);
      return refundPayments.filter((row) => row.docType === where.docType && where.docId.in.includes(row.docId));
    } },
  };
  const db = new Proxy(models, { get: (target, key: string) => target[key] ?? emptyModel });
  await mock.module("@/lib/db", { namedExports: { db } });
  reports = await import("@/lib/reports");
  ReportsContent = (await import("@/app/admin/(protected)/reports/ReportsContent")).default;
});
beforeEach(() => { refundWhere = []; paymentWhere = []; });

const filters = { from, to, fromInput: "2026-09-01", toInput: "2026-09-30",
  customerCodeFrom: "", customerCodeTo: "", supplierCodeFrom: "", supplierCodeTo: "",
  productCodeFrom: "", productCodeTo: "", expenseCodeFrom: "", expenseCodeTo: "" };

test("a ปรับยอด DN cash refund is money in with its refunded amount, label, account and supplier", { skip: mocksUnavailable }, async () => {
  const data = await reports.getReportsData(filters);
  const rows = data.dailyReceipts.items.map((row) =>
    [row.source, row.docNo, row.docDate.getTime(), row.counterpartCode, row.counterpartName, row.paymentMethod, row.accountName, row.amount, row.label]);
  assert.deepEqual(rows, [
    ["PURCHASE_RETURN", "PR26090001", returnDate.getTime(), "S001", "Supplier A", "เงินสด", "เงินสดหน้าร้าน", 107, undefined],
    ["SUPPLIER_DEBIT_REFUND", "SDN26090002", refundDate.getTime(), "S001", "Supplier A", "โอนเงิน", "KBank ร้าน", 150, "ปรับยอดจาก DN SDN26080001"],
  ]);
  assert.equal(data.dailyReceipts.supplierDebitRefundAmount, 150);
  assert.equal(data.dailyReceipts.purchaseReturnRefundAmount, 107, "purchase-return refunds keep their own total");
  assert.equal(data.dailyReceipts.totalAmount, 257);
  assert.deepEqual(refundWhere, [{ status: "ACTIVE", adjustsDebitNoteId: { not: null }, excessSettlementType: "CASH_REFUND",
    postingDate: { gte: from, lte: to } }]);
  assert.deepEqual(paymentWhere, [{ docType: "SUPPLIER_DEBIT_REFUND", docId: { in: ["adj-1", "adj-2"] } }]);
});

test("the supplier filter applies to ปรับยอด DN refunds, and no refund documents means no payment lookup", { skip: mocksUnavailable }, async () => {
  const data = await reports.getReportsData({ ...filters, supplierCodeFrom: "S999", supplierCodeTo: "S999" });
  assert.deepEqual(refundWhere.map((where) => where.supplier), [{ code: { gte: "S999", lte: "S999" } }]);
  assert.equal(data.dailyReceipts.supplierDebitRefundAmount, 0);
  assert.ok(!data.dailyReceipts.items.some((row) => row.source === "SUPPLIER_DEBIT_REFUND"));
  assert.deepEqual(paymentWhere, []);
});

test("the daily receipts CSV lists the refund under its ปรับยอด DN label", { skip: mocksUnavailable }, async () => {
  const csv = reports.buildReportsCsv(await reports.getReportsData(filters));
  const section = csv.slice(csv.indexOf("\"รายงานรับเงินประจำวัน\""), csv.indexOf("\"รายงานจ่ายเงินประจำวัน\""));
  assert.ok(section.includes(
    "\"ปรับยอดจาก DN SDN26080001\",\"SDN26090002\",\"2026-09-20\",\"S001\",\"Supplier A\",\"โอนเงิน\",\"KBank ร้าน\",\"150.00\",\"ซัพพลายเออร์โอนคืน\""));
  assert.ok(section.includes("\"รับเงินคืนซื้อ\",\"PR26090001\""), "purchase returns keep their label");
});

test("the management report shows the refund row label and its own summary card", { skip: mocksUnavailable }, async () => {
  const html = renderToStaticMarkup(createElement(ReportsContent, { data: await reports.getReportsData(filters) }));
  assert.match(html, /SDN26090002/);
  assert.match(html, /ปรับยอดจาก DN SDN26080001/);
  assert.match(html, /รับเงินคืนจากปรับยอด DN<\/p><p class="[^"]*dark:text-teal-300[^"]*">฿(<!-- -->)?150\.00/);
});
