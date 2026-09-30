import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

import type { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate } from "@/lib/th-date";
import { calcVat, type VatType } from "@/lib/vat";

// R11: DISCOUNT/OTHER credit notes reduce revenue only (quantity 0, cost 0) on cnDate.
// R6: the per-supplier purchase summary adds supplier DNs in their own column.

const date = parseDateOnlyToDate("2026-09-29");
const cents = (amount: number): number => Math.round(amount * 100);
const mocksUnavailable = typeof (mock as { module?: unknown }).module !== "function" && "requires module mocks";

type CreditNoteType = "RETURN" | "DISCOUNT" | "OTHER";

function makeSale() {
  return { id: "sale-1", saleNo: "IV-1", saleDate: date, status: "ACTIVE", vatType: "INCLUDING_VAT", vatRate: 7,
    ...calcVat(1070, "INCLUDING_VAT", 7), discount: 0, shippingFee: 0, customer: null, customerName: "Test",
    customerId: null, channel: "MANUAL", amountRemain: 0, paymentType: "CASH_SALE", paymentMethod: "CASH", note: null,
    cashBankAccount: null, items: [{ id: "sale-item-1", productId: "product-1", quantity: 2, costPrice: 300,
      totalAmount: 1070, lineDiscount: 0 }] };
}

const sale = makeSale();

function makeCreditNote(type: CreditNoteType, vatType: VatType, total: number,
  lines: Array<{ amount: number; qty: number; productId: string | null }>) {
  const header = calcVat(total, vatType, vatType === "NO_VAT" ? 0 : 7);
  return {
    id: `cn-${type}`, cnNo: `CN-${type}`, cnDate: date, status: "ACTIVE", type, channel: null, saleId: sale.id,
    totalAmount: header.netAmount, subtotalAmount: header.subtotalAmount, vatAmount: header.vatAmount,
    customerId: null, customer: null, customerName: "Test", settlementType: "CREDIT_DEBT", refundMethod: null,
    cashBankAccount: null, note: null, sale: { saleNo: sale.saleNo, channel: null, items: sale.items },
    items: lines.map((line, index) => ({
      id: `${type}-line-${index + 1}`, saleItemId: line.productId ? "sale-item-1" : null, productId: line.productId,
      qty: line.qty, amount: line.amount, unitPrice: line.amount, stockDisposition: "RESTOCK",
      product: line.productId ? { code: "P1", name: "สินค้า 1", avgCost: 300 } : null,
    })),
  };
}

type CreditNoteFixture = ReturnType<typeof makeCreditNote>;

let creditNotes: CreditNoteFixture[] = [];
let rows: Prisma.FactProfitCreateInput[] = [];
let facts: typeof import("@/lib/profit-fact");
let reports: typeof import("@/lib/reports");

const supplier = { code: "S001", name: "ซัพพลายเออร์ A" };
const purchase = { id: "po-1", purchaseNo: "PO-1", purchaseDate: date, purchaseType: "CREDIT_PURCHASE",
  paymentMethod: null, cashBankAccountId: null, referenceNo: null, note: null, supplierId: "sup-1",
  cashBankAccount: null, supplier, netAmount: 1000, amountRemain: 1000, vatAmount: 0 };
const purchaseReturn = { id: "pr-1", returnNo: "PR-1", returnDate: date, supplierId: "sup-1", supplier,
  totalAmount: 50, amountRemain: 0, settlementType: "SUPPLIER_CREDIT", refundMethod: null, note: null,
  cashBankAccount: null };
const debit = { varianceAmount: 0, vatAmount: 7, vatRecoverable: true, supplierId: "sup-1", netAmount: 107, supplier };

before(async () => {
  if (mocksUnavailable) return;
  const empty = { findMany: async () => [] };
  await mock.module("@/lib/db", { namedExports: { db: {
    sale: { findMany: async (args: { select: { items?: unknown } }) => (args.select.items ? [sale] : []) },
    creditNote: { findMany: async () => creditNotes },
    purchase: { findMany: async () => [purchase] },
    purchaseReturn: { findMany: async () => [purchaseReturn] },
    supplierDebitNote: { findMany: async (args: { select: { varianceAmount?: unknown } }) =>
      (args.select.varianceAmount ? [debit] : [{ amountRemain: 107 }]) },
    expense: empty, supplierAdvance: empty, customerAdvance: empty, supplierAdvanceRefund: empty,
    customerAdvanceRefund: empty, supplierPayment: empty, warranty: empty, warrantyClaim: empty, receipt: empty,
    $queryRaw: async () => [],
  } } });
  facts = await import("@/lib/profit-fact");
  reports = await import("@/lib/reports");
});

async function rebuild(creditNote: CreditNoteFixture): Promise<Prisma.FactProfitCreateInput[]> {
  rows = [];
  const tx = {
    creditNote: { findUnique: async () => creditNote },
    factProfit: {
      updateMany: async () => ({ count: 0 }),
      aggregate: async () => ({ _max: { versionNo: 1 } }),
      create: async ({ data }: { data: Prisma.FactProfitCreateInput }) => { rows.push(data); return data; },
    },
  } as unknown as Parameters<typeof facts.rebuildCreditNoteProfitFacts>[0];
  await facts.rebuildCreditNoteProfitFacts(tx, creditNote.id);
  return rows;
}

const sum = (list: Prisma.FactProfitCreateInput[], field: "salesAmountExVat" | "salesAmountIncVat" | "costAmount"
  | "grossProfit" | "quantity"): number => list.reduce((total, row) => total + cents(Number(row[field])), 0);

async function getReport() {
  return reports.getReportsData({ from: date, to: date, fromInput: "2026-09-29", toInput: "2026-09-29",
    customerCodeFrom: "", customerCodeTo: "", supplierCodeFrom: "", supplierCodeTo: "", productCodeFrom: "",
    productCodeTo: "", expenseCodeFrom: "", expenseCodeTo: "" });
}

test("golden DISCOUNT 107 incl. 7%: revenue -100 ex VAT, VAT -7, quantity and cost 0", { skip: mocksUnavailable }, async () => {
  // One product line and one line without a product; the CN line carries qty 1, which must not count.
  const creditNote = makeCreditNote("DISCOUNT", "INCLUDING_VAT", 107, [
    { amount: 80.25, qty: 1, productId: "product-1" },
    { amount: 26.75, qty: 1, productId: null },
  ]);
  assert.equal(creditNote.subtotalAmount, 100);
  const discountRows = await rebuild(creditNote);
  assert.equal(discountRows.length, 2);
  assert.equal(sum(discountRows, "salesAmountExVat"), -10_000);
  assert.equal(sum(discountRows, "salesAmountIncVat"), -10_700);
  assert.equal(sum(discountRows, "costAmount"), 0);
  assert.equal(sum(discountRows, "grossProfit"), -10_000);
  assert.ok(discountRows.every((row) => Number(row.quantity) === 0 && Number(row.unitCostPrice) === 0));
  assert.ok(discountRows.every((row) => row.sourceType === "SALE_RETURN" && row.sourceSubtype === "DISCOUNT"));
  assert.ok(discountRows.every((row) => row.businessDate === date));
  assert.deepEqual(discountRows.map((row) => Number(row.salesAmountExVat)), [-75, -25]);
  assert.equal(discountRows[0].productId, "product-1");
  assert.equal(discountRows[1].productId, null);
  assert.equal(discountRows[1].lineLabel, "ลดหนี้ (ส่วนลด)");
});

test("golden OTHER on NO_VAT: revenue equals the posted total, no VAT, no quantity or cost", { skip: mocksUnavailable }, async () => {
  const otherRows = await rebuild(makeCreditNote("OTHER", "NO_VAT", 50, [{ amount: 50, qty: 3, productId: null }]));
  assert.equal(otherRows.length, 1);
  assert.equal(Number(otherRows[0].salesAmountExVat), -50);
  assert.equal(Number(otherRows[0].salesAmountIncVat), -50);
  assert.equal(Number(otherRows[0].quantity), 0);
  assert.equal(Number(otherRows[0].costAmount), 0);
  assert.equal(otherRows[0].sourceSubtype, "OTHER");
  assert.equal(otherRows[0].lineLabel, "ลดหนี้ (อื่นๆ)");
});

test("golden RETURN unchanged: returned quantity and historic cost are reversed", { skip: mocksUnavailable }, async () => {
  const returnRows = await rebuild(makeCreditNote("RETURN", "INCLUDING_VAT", 535, [
    { amount: 535, qty: 1, productId: "product-1" },
  ]));
  assert.equal(returnRows.length, 1);
  assert.equal(Number(returnRows[0].quantity), -1);
  assert.equal(Number(returnRows[0].salesAmountExVat), -500);
  assert.equal(Number(returnRows[0].salesAmountIncVat), -535);
  assert.equal(Number(returnRows[0].costAmount), -300);
  assert.equal(returnRows[0].lineLabel, "สินค้า 1");
});

test("golden cancelled DISCOUNT leaves no active facts", { skip: mocksUnavailable }, async () => {
  const creditNote = makeCreditNote("DISCOUNT", "INCLUDING_VAT", 107, [{ amount: 107, qty: 1, productId: "product-1" }]);
  creditNote.status = "CANCELLED";
  assert.equal((await rebuild(creditNote)).length, 0);
});

test("golden P&L counts DISCOUNT as revenue reduction only; sales summary keeps returns", { skip: mocksUnavailable }, async () => {
  creditNotes = [makeCreditNote("DISCOUNT", "INCLUDING_VAT", 107, [{ amount: 107, qty: 1, productId: "product-1" }])];
  const report = await getReport();
  assert.equal(report.profitLoss.grossSales, 1000);
  assert.equal(report.profitLoss.salesReturns, 100);
  assert.equal(report.profitLoss.netRevenue, 900);
  // The RESTOCK disposition on a DISCOUNT line never reverses cost of goods sold.
  assert.equal(report.profitLoss.costOfGoodsSold, 600);
  assert.equal(report.profitLoss.grossProfit, 300);
  assert.equal(report.profitLoss.creditNoteVat, 7);
  assert.equal(report.salesSummary.returnAmount, 0);
  assert.equal(report.salesSummary.netSaleAmount, 1070);
  // FactProfit agrees with the P&L: sale 1000 - cost 600 - discount 100.
  const discountRows = await rebuild(creditNotes[0]);
  assert.equal(1000 - 600 + sum(discountRows, "grossProfit") / 100, report.profitLoss.grossProfit);
  creditNotes = [];
});

test("golden supplier summary: purchases + DN (posted) - returns = net, DN adds no purchase document", { skip: mocksUnavailable }, async () => {
  creditNotes = [];
  const report = await getReport();
  assert.equal(report.suppliers.items.length, 1);
  const row = report.suppliers.items[0];
  assert.equal(row.supplierName, "ซัพพลายเออร์ A");
  assert.equal(row.purchaseCount, 1);
  assert.equal(row.purchaseAmount, 1000);
  assert.equal(row.debitAmount, 107);
  assert.equal(row.returnAmount, 50);
  assert.equal(row.netPurchaseAmount, 1057);
  assert.equal(report.suppliers.totalDebitAmount, 107);
  assert.equal(report.suppliers.netPurchaseAmount, 1057);
  assert.equal(report.payables.debitOutstanding, 107);
  const csv = reports.buildReportsCsv(report);
  assert.ok(csv.includes('"ซื้อสินค้า","DN (ค่าใช้จ่ายเพิ่ม)","คืน/ลดหนี้","สุทธิ"'));
  assert.ok(csv.includes('"S001","ซัพพลายเออร์ A","1","1000.00","107.00","50.00","1057.00"'));
});
