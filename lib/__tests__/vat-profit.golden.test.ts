import assert from "node:assert/strict";
import test, { before, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { calcVat, calcItemSubtotal, type VatType } from "@/lib/vat";
import { allocateSaleProfitRevenue } from "@/lib/sale-profit-revenue";
import { parseDateOnlyToDate } from "@/lib/th-date";

const date = parseDateOnlyToDate("2026-09-29");
const modes: VatType[] = ["NO_VAT", "EXCLUDING_VAT", "INCLUDING_VAT"];
const cents = (amount: number) => Math.round(amount * 100);

for (const mode of modes) {
  test(`golden VAT ${mode}: 1000 base reconciles with document tax`, () => {
    const entered = mode === "INCLUDING_VAT" ? 1070 : 1000;
    const result = calcVat(entered, mode, 7);
    assert.equal(result.subtotalAmount, 1000);
    assert.equal(calcItemSubtotal(entered, mode, 7), 1000);
    assert.equal(result.netAmount, mode === "NO_VAT" ? 1000 : 1070);
  });
}

test("golden including VAT extracts cents, fractional totals and zero-rate amounts", () => {
  assert.equal(calcItemSubtotal(10.7, "INCLUDING_VAT", 7), 10);
  assert.equal(calcItemSubtotal(0.03, "INCLUDING_VAT", 7), 0.03);
  assert.equal(calcItemSubtotal(1070, "INCLUDING_VAT", 0), 1070);
});

test("golden revenue assigns a single cent once across 100 lines without negative residual", () => {
  const result = allocateSaleProfitRevenue({ itemAmounts: Array(100).fill(0.01), shippingFee: 0,
    discount: 0.99, subtotalAmount: 0.01, netAmount: 0.01 });
  assert.equal(result.items.reduce((sum, row) => sum + cents(row.exVat), 0), 1);
  assert.ok(result.items.every((row) => row.exVat >= 0 && row.incVat >= row.exVat));
  assert.equal(result.shipping.incVat, 0);
});

for (const mode of modes) {
  test(`golden ${mode}: multi-line discount and shipping tie exactly to header cents`, () => {
    const totals = calcVat(0.15, mode, 7);
    const result = allocateSaleProfitRevenue({ itemAmounts: [0.03, 0.07, 0.06], shippingFee: 0.04,
      discount: 0.05, subtotalAmount: totals.subtotalAmount, netAmount: totals.netAmount });
    const rows = [...result.items, result.shipping];
    assert.equal(rows.reduce((sum, row) => sum + cents(row.exVat), 0), cents(totals.subtotalAmount));
    assert.equal(rows.reduce((sum, row) => sum + cents(row.incVat), 0), cents(totals.netAmount));
    assert.ok(rows.every((row) => row.incVat >= row.exVat));
  });
}

test("golden header discount exhausts products before reducing shipping", () => {
  const result = allocateSaleProfitRevenue({ itemAmounts: [100, 0], shippingFee: 50,
    discount: 120, subtotalAmount: 30, netAmount: 32.1 });
  assert.deepEqual(result.items, [{ exVat: 0, incVat: 0 }, { exVat: 0, incVat: 0 }]);
  assert.deepEqual(result.shipping, { exVat: 30, incVat: 32.1 });
});

test("golden fully discounted sale has no revenue; inconsistent header fails closed", () => {
  assert.deepEqual(allocateSaleProfitRevenue({ itemAmounts: [100], shippingFee: 50,
    discount: 200, subtotalAmount: 0, netAmount: 0 }).items, [{ exVat: 0, incVat: 0 }]);
  assert.throws(() => allocateSaleProfitRevenue({ itemAmounts: [0], shippingFee: 0,
    discount: 0, subtotalAmount: 10, netAmount: 10 }), /no allocation basis/);
});

function makeSale(mode: VatType, itemAmounts = [mode === "INCLUDING_VAT" ? 1070 : 1000], shippingFee = 0, discount = 0) {
  const totals = calcVat(Math.max(itemAmounts.reduce((sum, amount) => sum + amount, 0) + shippingFee - discount, 0), mode, 7);
  return { id: "sale-1", saleNo: "IV-1", saleDate: date, status: "ACTIVE" as "ACTIVE" | "CANCELLED", vatType: mode,
    vatRate: 7, ...totals, discount, shippingFee, customer: null, customerName: "Test", customerId: null,
    channel: "MANUAL", amountRemain: 0, paymentType: "CASH_SALE", paymentMethod: "CASH",
    note: null, cashBankAccount: null, items: itemAmounts.map((totalAmount, index) => ({
      id: `item-${index}`, productId: `product-${index}`, quantity: index === 0 ? 0.5 : 1,
      costPrice: index === 0 ? 1200 : 10, totalAmount, subtotalAmount: 10, lineDiscount: 0,
      supplierId: null, supplierName: null, product: { code: `P${index}`, name: "Test" },
    })) };
}

let sale = makeSale("NO_VAT");
const expense = { id: "expense-1", expenseNo: "OE-1", expenseDate: date, status: "ACTIVE", channel: null,
  netAmount: 107, totalAmount: 100, vatAmount: 7, cashBankAccount: null, note: null,
  items: [{ id: "expense-item", amount: 100, description: "Test", expenseCode: { code: "OE", name: "Test" } }] };
let creditNotes: ReturnType<typeof makeCreditNote>[] = [];
let debits: { varianceAmount: number; vatAmount: number; vatRecoverable: boolean }[] = [];
let rows: Prisma.FactProfitCreateInput[] = [];
let facts: typeof import("@/lib/profit-fact");
let reports: typeof import("@/lib/reports");
const mocksUnavailable = typeof (mock as { module?: unknown }).module !== "function" && "requires module mocks";

function makeCreditNote() {
  return { id: "cn-1", cnNo: "CN-1", cnDate: date, status: "ACTIVE", type: "RETURN", channel: null,
    totalAmount: 214, subtotalAmount: 200, vatAmount: 14, customerId: null, customer: null, customerName: "Test",
    saleId: sale.id, sale: { saleNo: sale.saleNo, channel: null, items: sale.items }, settlementType: "CREDIT_DEBT",
    refundMethod: null, cashBankAccount: null, note: null,
    items: [{ id: "cn-item", saleItemId: sale.items[0].id, productId: sale.items[0].productId,
      qty: 0.1, amount: 214, unitPrice: 2140, stockDisposition: "RESTOCK",
      product: { code: "P0", name: "Test", avgCost: 9999 } }] };
}

before(async () => {
  if (mocksUnavailable) return;
  const empty = { findMany: async () => [] };
  await mock.module("@/lib/db", { namedExports: { db: {
    sale: { findMany: async (args: { select: { items?: unknown } }) => args.select.items ? [sale] : [] },
    expense: { findMany: async () => [expense] }, creditNote: { findMany: async () => creditNotes },
    supplierDebitNote: { findMany: async () => debits }, purchase: empty, purchaseReturn: empty,
    supplierAdvance: empty, customerAdvance: empty, supplierAdvanceRefund: empty, customerAdvanceRefund: empty,
    supplierPayment: empty, warranty: empty, warrantyClaim: empty, receipt: empty, $queryRaw: async () => [],
  } } });
  facts = await import("@/lib/profit-fact");
  reports = await import("@/lib/reports");
});

function fakeTx(): Parameters<typeof facts.rebuildSaleProfitFacts>[0] {
  return { sale: { findUnique: async () => sale }, expense: { findUnique: async () => expense },
    creditNote: { findUnique: async () => creditNotes[0] },
    factProfit: { updateMany: async () => { rows = []; return { count: 0 }; },
      aggregate: async () => ({ _max: { versionNo: 1 } }),
      create: async ({ data }: { data: Prisma.FactProfitCreateInput }) => { rows.push(data); return data; } },
  } as unknown as Parameters<typeof facts.rebuildSaleProfitFacts>[0];
}

async function getReport() {
  return reports.getReportsData({ from: date, to: date, fromInput: "2026-09-29", toInput: "2026-09-29",
    customerCodeFrom: "", customerCodeTo: "", supplierCodeFrom: "", supplierCodeTo: "", productCodeFrom: "",
    productCodeTo: "", expenseCodeFrom: "", expenseCodeTo: "" });
}

for (const mode of modes) {
  test(`golden ${mode}: P&L and actual FactProfit gross 400/net 293; cash summaries retain VAT`, { skip: mocksUnavailable }, async () => {
    sale = makeSale(mode); creditNotes = []; debits = []; rows = [];
    const original = structuredClone(sale);
    await facts.rebuildSaleProfitFacts(fakeTx(), sale.id);
    assert.equal(Number(rows[0].salesAmountExVat), 1000);
    assert.equal(Number(rows[0].salesAmountIncVat), sale.netAmount);
    assert.equal(Number(rows[0].costAmount), 600);
    assert.equal(Number(rows[0].grossProfit), 400);
    const saleNetProfit = Number(rows[0].netProfitAmount);
    await facts.rebuildExpenseProfitFacts(fakeTx(), expense.id);
    assert.equal(Number(rows[0].expenseAmount), 107);
    const factNetProfit = saleNetProfit + Number(rows[0].netProfitAmount);
    const report = await getReport();
    assert.equal(report.profitLoss.grossProfit, 400);
    assert.equal(report.profitLoss.netProfit, 293);
    assert.equal(report.profitLoss.netProfit, factNetProfit);
    assert.equal(report.salesSummary.grossSalesAmount, sale.netAmount);
    assert.equal(report.salesSummary.byDay[0].netSaleAmount, sale.netAmount);
    assert.equal(report.dailyReceipts.items[0].amount, sale.netAmount);
    assert.deepEqual(sale, original);
  });
}

test("golden return excludes output VAT once, reverses historic cost, DN variance remains one expense", { skip: mocksUnavailable }, async () => {
  sale = makeSale("INCLUDING_VAT"); creditNotes = [makeCreditNote()]; debits = [{ varianceAmount: 30, vatAmount: 7, vatRecoverable: true }];
  await facts.rebuildCreditNoteProfitFacts(fakeTx(), "cn-1");
  assert.equal(Number(rows[0].salesAmountExVat), -200);
  assert.equal(Number(rows[0].salesAmountIncVat), -214);
  assert.equal(Number(rows[0].costAmount), -120);
  const report = await getReport();
  assert.equal(report.profitLoss.netRevenue, 800);
  assert.equal(report.profitLoss.costOfGoodsSold, 510);
  assert.equal(report.profitLoss.grossProfit, 290);
  assert.equal(report.profitLoss.netProfit, 183);
  assert.equal(report.profitLoss.salesVat, 70);
  assert.equal(report.profitLoss.creditNoteVat, 14);
  assert.equal(report.salesSummary.returnAmount, 214);
  assert.equal(report.salesSummary.netSaleAmount, 856);
});

test("golden rebuilt sale includes shipping and discount and exactly matches posted header", { skip: mocksUnavailable }, async () => {
  sale = makeSale("INCLUDING_VAT", [107, 0, 53.5], 10.7, 12.3);
  await facts.rebuildSaleProfitFacts(fakeTx(), sale.id);
  assert.equal(rows.reduce((sum, row) => sum + cents(Number(row.salesAmountExVat)), 0), cents(sale.subtotalAmount));
  assert.equal(rows.reduce((sum, row) => sum + cents(Number(row.salesAmountIncVat)), 0), cents(sale.netAmount));
  assert.equal(rows.find((row) => row.sourceLineId === "sale-1:shipping")?.lineLabel, "ค่าจัดส่ง");
  const before = rows.map((row) => Number(row.salesAmountExVat));
  await facts.rebuildSaleProfitFacts(fakeTx(), sale.id);
  assert.deepEqual(rows.map((row) => Number(row.salesAmountExVat)), before);
});

test("golden canceled sale leaves no active rebuilt revenue", { skip: mocksUnavailable }, async () => {
  sale.status = "CANCELLED";
  await facts.rebuildSaleProfitFacts(fakeTx(), sale.id);
  assert.equal(rows.length, 0);
});
