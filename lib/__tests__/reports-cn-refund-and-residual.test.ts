import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate, parseDateOnlyToEndOfDay } from "@/lib/th-date";

// lib/reports.ts:
// - T8d: a DISCOUNT/OTHER credit note refunded in cash is money paid out too, so it joins the
//   "คืนเงิน CN" payments with its full amount and a type label (it was RETURN-only).
// - T3: stock value written off at zero on-hand (STOCK_VALUE_RESIDUAL facts) is a cost in the P&L.

const mocksUnavailable = typeof (mock as { module?: unknown }).module !== "function" && "requires module mocks";
const from = parseDateOnlyToDate("2026-09-01");
const to = parseDateOnlyToEndOfDay("2026-09-30");
const cnDate = parseDateOnlyToDate("2026-09-20");
const D = (value: number) => new Prisma.Decimal(value);
const creditNote = (cnNo: string, type: string, settlementType: string, total: number, note: string | null) => ({
  id: cnNo, cnNo, cnDate, type, customerName: "ลูกค้าทั่วไป", totalAmount: D(total), subtotalAmount: D(total), vatAmount: D(0), note,
  settlementType, refundMethod: "TRANSFER", cashBankAccount: { name: "บัญชีร้าน" }, customer: null, sale: null, items: [],
});
let residualTotal: number | null = 200;
let residualQueries = 0;
let reports: typeof import("@/lib/reports");

before(async () => {
  if (mocksUnavailable) return;
  const emptyModel = { findMany: async () => [] };
  const models: Record<string, unknown> = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      if (!strings.join("?").includes("STOCK_VALUE_RESIDUAL")) return [];
      residualQueries += 1;
      return [{ total: residualTotal === null ? null : D(residualTotal) }];
    },
    creditNote: { findMany: async () => [
      creditNote("CN-RET", "RETURN", "CASH_REFUND", 107, "คืนของ"),
      creditNote("CN-DIS", "DISCOUNT", "CASH_REFUND", 53.5, null),
      creditNote("CN-OTH", "OTHER", "CASH_REFUND", 20, "ชดเชยค่าส่ง"),
      creditNote("CN-DEBT", "DISCOUNT", "CREDIT_DEBT", 30, null),
    ] },
  };
  const db = new Proxy(models, { get: (target, key: string) => target[key] ?? emptyModel });
  await mock.module("@/lib/db", { namedExports: { db } });
  reports = await import("@/lib/reports");
});
beforeEach(() => { residualTotal = 200; residualQueries = 0; });

const filters = { from, to, fromInput: "2026-09-01", toInput: "2026-09-30",
  customerCodeFrom: "", customerCodeTo: "", supplierCodeFrom: "", supplierCodeTo: "",
  productCodeFrom: "", productCodeTo: "", expenseCodeFrom: "", expenseCodeTo: "" };

test("T8d: cash-refunded DISCOUNT and OTHER credit notes join the CN refund payments with their full amount and type", { skip: mocksUnavailable }, async () => {
  const data = await reports.getReportsData(filters);
  const refunds = data.dailyPayments.items.filter((row) => row.source === "CN_SALE");
  assert.deepEqual(refunds.map((row) => [row.docNo, row.amount, row.note]), [
    ["CN-DIS", 53.5, "ลดหนี้ (ส่วนลด)"], ["CN-OTH", 20, "ลดหนี้ (อื่นๆ) · ชดเชยค่าส่ง"], ["CN-RET", 107, "คืนสินค้า · คืนของ"],
  ]);
  assert.equal(data.dailyPayments.creditNoteRefundAmount, 180.5);
  // A DISCOUNT settled against the customer's debt moves no cash.
  assert.ok(!refunds.some((row) => row.docNo === "CN-DEBT"));
  // The sales summary still counts returns only.
  assert.equal(data.salesSummary.returnAmount, 107);
});

test("T3: the P&L adds the stock value residual once to cost of goods sold and lists it in the export", { skip: mocksUnavailable }, async () => {
  const data = await reports.getReportsData(filters);
  assert.equal(residualQueries, 1);
  assert.equal(data.profitLoss.stockValueResidual, 200);
  assert.equal(data.profitLoss.costOfGoodsSold, 200);
  assert.equal(data.profitLoss.grossProfit, data.profitLoss.netRevenue - 200);
  assert.match(reports.buildReportsCsv(data), /ผลต่างมูลค่าสต็อก \(รวมในต้นทุนด้านบน\)",?"?200\.00/);
  residualTotal = null;
  assert.equal((await reports.getReportsData(filters)).profitLoss.stockValueResidual, 0);
});

test("T3: a supplier filter leaves the residual out (the fact names no supplier)", { skip: mocksUnavailable }, async () => {
  const data = await reports.getReportsData({ ...filters, supplierCodeFrom: "S001", supplierCodeTo: "S001" });
  assert.equal(residualQueries, 0);
  assert.equal(data.profitLoss.stockValueResidual, 0);
});
