import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate, parseDateOnlyToEndOfDay } from "@/lib/th-date";
import type { ParsedReportFilters, ReportsData, ReportsFullData } from "@/lib/reports";

/**
 * R4 (review 2026-11-12): the Summary and Print pages call getReportsSummaryData(), which builds only
 * the sections ReportsContent renders. It must give exactly the numbers getReportsData() (every section,
 * the previous code path) gives for those sections, on the same rows, and render the same HTML — while it
 * no longer reads the sale / credit-note lines, the purchase a return inherits VAT from, the FactProfit
 * variance sums, the VAT registration setting or the expiring warranties.
 *
 * The mock returns only the columns a query selects (like Prisma), so the summary scope cannot use data
 * it no longer loads. The line-discount memo is the one number computed differently: SUM(lineDiscount)
 * in SQL instead of adding the loaded lines in JS. Both are the sum of the same 2-decimal amounts, so it
 * is compared to the cent and through the rendered HTML (JS addition can differ in the last binary digit).
 */
const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" && "requires --experimental-test-module-mocks";

type Row = Record<string, unknown>;
type Select = Record<string, unknown>;
type FindManyArgs = { where?: Row; select?: Select; orderBy?: unknown; take?: number };

const D = (value: string | number): Prisma.Decimal => new Prisma.Decimal(value);
const day = (value: string): Date => parseDateOnlyToDate(value);
const account = { name: "KBank ร้าน" };
const cash = { name: "เงินสดหน้าร้าน" };
const supplierA = { code: "S001", name: "ซัพพลายเออร์ ก" };
const customerA = { code: "C001", name: "ลูกค้า ก" };

/** Prisma-like projection: only the selected keys, nested selects applied to relations. */
function project(row: Row, select: Select): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(select)) {
    if (value === false || value === undefined) continue;
    const field = row[key];
    const nested = typeof value === "object" && value !== null ? (value as { select?: Select }).select : undefined;
    if (!nested) out[key] = field;
    else if (Array.isArray(field)) out[key] = field.map((item: Row) => project(item, nested));
    else out[key] = field === null || field === undefined ? null : project(field as Row, nested);
  }
  return out;
}

const SALES: Row[] = [
  { id: "sale-1", saleNo: "IV2611010001", saleDate: day("2026-11-01"), customerName: null, netAmount: D("1070.00"),
    subtotalAmount: D("1000.00"), vatAmount: D("70.00"), amountRemain: D("0"), paymentType: "CASH_SALE", paymentMethod: "CASH",
    note: null, cashBankAccount: cash, customer: customerA,
    items: [{ quantity: D("2.5000"), costPrice: D("300.00"), lineDiscount: D("0.10") },
      { quantity: D("1"), costPrice: D("120.00"), lineDiscount: D("0.20") }] },
  { id: "sale-2", saleNo: "IV2611020001", saleDate: day("2026-11-02"), customerName: "ลูกค้าเดินหน้าร้าน", netAmount: D("535.00"),
    subtotalAmount: D("500.00"), vatAmount: D("35.00"), amountRemain: D("535.00"), paymentType: "CREDIT_SALE", paymentMethod: null,
    note: "ส่งของ", cashBankAccount: null, customer: null,
    items: [{ quantity: D("3"), costPrice: D("90.00"), lineDiscount: D("10.15") }] },
  { id: "sale-3", saleNo: "IV2611030001", saleDate: day("2026-11-03"), customerName: null, netAmount: D("0.30"),
    subtotalAmount: D("0.28"), vatAmount: D("0.02"), amountRemain: D("0"), paymentType: "CASH_SALE", paymentMethod: "TRANSFER",
    note: null, cashBankAccount: account, customer: { code: null, name: "ลูกค้า ข" },
    items: [{ quantity: D("1"), costPrice: D("0.10"), lineDiscount: D("0.00") }] },
];
const OUTSTANDING_SALES: Row[] = [
  { id: "sale-2", saleNo: "IV2611020001", saleDate: day("2026-11-02"), customerName: "ลูกค้าเดินหน้าร้าน", amountRemain: D("535.00"),
    paymentType: "CREDIT_SALE", fulfillmentType: "DELIVERY", shippingStatus: "SHIPPED", customer: null },
  { id: "sale-old", saleNo: "IV2608150001", saleDate: day("2026-08-15"), customerName: null, amountRemain: D("99.99"),
    paymentType: "CREDIT_SALE", fulfillmentType: "PICKUP", shippingStatus: null, customer: customerA },
];
const CREDIT_NOTES: Row[] = [
  { id: "cn-1", cnNo: "CN2611040001", cnDate: day("2026-11-04"), type: "RETURN", customerName: null, totalAmount: D("214.00"),
    subtotalAmount: D("200.00"), vatAmount: D("14.00"), note: "คืนของ", settlementType: "CASH_REFUND", refundMethod: "TRANSFER",
    cashBankAccount: account, customer: customerA,
    sale: { items: [{ id: "si-1", productId: "p-1", quantity: D("2.5"), costPrice: D("300.00") }] },
    items: [{ saleItemId: "si-1", productId: "p-1", qty: D("1"), amount: D("200.00"), stockDisposition: "RETURN_TO_STOCK",
      product: { avgCost: D("280.00") } }] },
  { id: "cn-2", cnNo: "CN2611050001", cnDate: day("2026-11-05"), type: "DISCOUNT", customerName: "ลูกค้าเดินหน้าร้าน",
    totalAmount: D("53.50"), subtotalAmount: D("50.00"), vatAmount: D("3.50"), note: null, settlementType: "CREDIT_DEBT",
    refundMethod: null, cashBankAccount: null, customer: null, sale: { items: [] },
    items: [{ saleItemId: null, productId: null, qty: D("1"), amount: D("50.00"), stockDisposition: null, product: null }] },
];
const PURCHASES: Row[] = [
  { id: "pu-1", purchaseNo: "PU2611010001", purchaseDate: day("2026-11-01"), purchaseType: "CASH_PURCHASE", paymentMethod: "CASH",
    cashBankAccountId: "acc-cash", referenceNo: "INV-77", note: null, supplierId: "sup-1", cashBankAccount: cash, supplier: supplierA,
    netAmount: D("1070.00"), amountRemain: D("0"), vatAmount: D("70.00"), vatType: "EXCLUDING_VAT", vatRate: D("7"),
    taxInvoiceDate: day("2026-11-01") },
  { id: "pu-2", purchaseNo: "PU2611020001", purchaseDate: day("2026-11-02"), purchaseType: "CREDIT_PURCHASE", paymentMethod: null,
    cashBankAccountId: null, referenceNo: null, note: "เครดิต 30 วัน", supplierId: "sup-1", cashBankAccount: null, supplier: supplierA,
    netAmount: D("2140.00"), amountRemain: D("1500.00"), vatAmount: D("140.00"), vatType: "EXCLUDING_VAT", vatRate: D("7"),
    taxInvoiceDate: null },
];
const PURCHASE_RETURNS: Row[] = [
  { id: "pr-1", returnNo: "PR2611030001", returnDate: day("2026-11-03"), supplierId: "sup-1", supplier: supplierA,
    totalAmount: D("107.00"), amountRemain: D("0"), settlementType: "CASH_REFUND", refundMethod: "CASH", note: null,
    cashBankAccount: cash, vatAmount: D("7.00"), vatType: "EXCLUDING_VAT", vatRate: D("7"), taxInvoiceDate: null,
    purchase: { vatType: "EXCLUDING_VAT", vatRate: D("7"), taxInvoiceDate: day("2026-11-01") } },
  { id: "pr-2", returnNo: "PR2611040001", returnDate: day("2026-11-04"), supplierId: null, supplier: null,
    totalAmount: D("53.50"), amountRemain: D("53.50"), settlementType: "SUPPLIER_CREDIT", refundMethod: null, note: "ลดหนี้",
    cashBankAccount: null, vatAmount: D("3.50"), vatType: "EXCLUDING_VAT", vatRate: D("7"), taxInvoiceDate: day("2026-11-04"),
    purchase: null },
];
const EXPENSES: Row[] = [
  { id: "ex-1", expenseNo: "EX2611010001", expenseDate: day("2026-11-01"), note: null, totalAmount: D("100.00"), vatAmount: D("7.00"),
    netAmount: D("107.00"), subtotalAmount: D("100.00"), vatType: "EXCLUDING_VAT", vatRate: D("7"), taxInvoiceDate: day("2026-11-01"),
    cashBankAccount: account, items: [{ amount: D("60.00"), description: "ค่าส่ง", expenseCode: { code: "E01", name: "ค่าขนส่ง" } },
      { amount: D("40.00"), description: null, expenseCode: { code: "E02", name: "ค่าบริการ" } }] },
];
const SUPPLIER_ADVANCES: Row[] = [
  { id: "sa-1", advanceNo: "SA2611010001", advanceDate: day("2026-11-01"), totalAmount: D("5000.00"), amountRemain: D("1250.50"),
    paymentMethod: "TRANSFER", note: null, cashBankAccount: account, supplier: supplierA },
];
const CUSTOMER_ADVANCES: Row[] = [
  { advanceNo: "CA2611020001", advanceDate: day("2026-11-02"), totalAmount: D("300.00"), paymentMethod: "CASH", note: "มัดจำ",
    cashBankAccount: cash, customer: customerA },
];
const SUPPLIER_ADVANCE_REFUNDS: Row[] = [
  { refundNo: "SR2611030001", refundDate: day("2026-11-03"), refundAmount: D("55.55"), paymentMethod: "TRANSFER", note: null,
    cashBankAccount: account, supplierAdvance: { advanceNo: "SA2610010001", supplier: supplierA } },
];
const CUSTOMER_ADVANCE_REFUNDS: Row[] = [
  { refundNo: "CR2611040001", refundDate: day("2026-11-04"), refundAmount: D("25.00"), paymentMethod: "CASH", note: "คืนมัดจำ",
    cashBankAccount: cash, customerAdvance: { advanceNo: "CA2610010001", customer: customerA } },
];
const SUPPLIER_PAYMENTS: Row[] = [
  { id: "sp-1", paymentNo: "SP2611050001", paymentDate: day("2026-11-05"), totalAmount: D("640.00"), paymentMethod: "TRANSFER",
    note: null, cashBankAccount: account, supplier: supplierA },
  { id: "sp-2", paymentNo: "SP2611050002", paymentDate: day("2026-11-05"), totalAmount: D("0"), paymentMethod: "CREDIT",
    note: "หักมัดจำ", cashBankAccount: null, supplier: supplierA },
];
const DEBITS: Row[] = [
  { varianceAmount: D("30.00"), vatAmount: D("21.00"), vatRecoverable: true, supplierId: "sup-1", netAmount: D("321.00"),
    supplier: supplierA, items: [{ varianceAmount: D("30.00") }] },
];
const DEBIT_OUTSTANDING: Row[] = [{ amountRemain: D("321.00") }, { amountRemain: D("-20.00") }];
const DEBIT_REFUNDS: Row[] = [
  { id: "adj-1", debitNo: "SDN2611060002", postingDate: day("2026-11-06"), excessSettlementType: "CASH_REFUND", refundMethod: "TRANSFER",
    note: null, cashBankAccount: account, supplier: supplierA, adjustsDebitNote: { debitNo: "SDN2610010001" } },
];
const RECEIPTS: Row[] = [
  { id: "rc-1", receiptNo: "RC2611060001", receiptDate: day("2026-11-06"), customerName: null, paymentMethod: "TRANSFER",
    totalAmount: D("200.00"), note: null, cashBankAccount: account, customer: customerA },
];
const WARRANTIES: Row[] = [
  { id: "w-1", endDate: day("2026-11-20"), customerName: null, product: { code: "A001", name: "คอมแอร์" },
    sale: { saleNo: "IV2605010001", customerName: "ลูกค้า ก" }, customer: null },
];
const OPEN_CLAIMS: Row[] = [
  { id: "cl-1", claimNo: "CL2611010001", claimDate: day("2026-11-01"), claimType: "REPLACE_NOW", status: "DRAFT", supplierName: " ",
    warranty: { customerName: "ลูกค้า ค", product: { code: "A002", name: "หม้อน้ำ" }, sale: null, customer: null } },
];
const STOCK_ROW = {
  totals: { activeProductCount: 1229, totalUnitsOnHand: 5321.5, totalStockValue: 1335748.25, lowStockCount: 2 },
  lowStockItems: [{ id: "p-9", code: "A009", name: "สายพาน", categoryName: "อะไหล่อื่นๆ", stock: 0, minStock: 2, avgCost: 45.5, stockValue: 0 }],
  highestValueItems: [{ id: "p-1", code: "A001", name: "คอมแอร์", categoryName: "คอมแอร์", stock: 12, minStock: 1, avgCost: 4200, stockValue: 50400 }],
};

type Call = { model: string; args: FindManyArgs };
const calls: Call[] = [];
const rawQueries: string[] = [];
let registrationReads = 0;

/** Like a PrismaPromise, the query runs (and is recorded) only when it is awaited. */
function lazyQuery<T>(run: () => T): PromiseLike<T> {
  let result: Promise<T> | undefined;
  return {
    then: <A = T, B = never>(onFulfilled?: ((value: T) => A | PromiseLike<A>) | null,
      onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> =>
      (result ??= Promise.resolve().then(run)).then(onFulfilled, onRejected),
  };
}

function model(name: string, rows: (args: FindManyArgs) => Row[]) {
  return {
    findMany: (args: FindManyArgs): PromiseLike<Row[]> => lazyQuery(() => {
      calls.push({ model: name, args });
      return rows(args).map((row) => (args.select ? project(row, args.select) : row));
    }),
  };
}

let reports: typeof import("@/lib/reports");
let ReportsContent: typeof import("@/app/admin/(protected)/reports/ReportsContent").default;

before(async () => {
  if (moduleMocksUnavailable) return;
  const db = {
    sale: model("sale", (args) => (args.where && "amountRemain" in args.where ? OUTSTANDING_SALES : SALES)),
    creditNote: model("creditNote", () => CREDIT_NOTES),
    purchase: model("purchase", () => PURCHASES),
    purchaseReturn: model("purchaseReturn", () => PURCHASE_RETURNS),
    expense: model("expense", () => EXPENSES),
    supplierAdvance: model("supplierAdvance", () => SUPPLIER_ADVANCES),
    customerAdvance: model("customerAdvance", () => CUSTOMER_ADVANCES),
    supplierAdvanceRefund: model("supplierAdvanceRefund", () => SUPPLIER_ADVANCE_REFUNDS),
    customerAdvanceRefund: model("customerAdvanceRefund", () => CUSTOMER_ADVANCE_REFUNDS),
    supplierPayment: model("supplierPayment", () => SUPPLIER_PAYMENTS),
    supplierDebitNote: model("supplierDebitNote", (args) => (args.where && "receivedDate" in args.where
      ? DEBIT_OUTSTANDING
      : args.where && "adjustsDebitNoteId" in args.where ? DEBIT_REFUNDS : DEBITS)),
    documentPayment: model("documentPayment", () => [{ docId: "adj-1", amount: D("100.10") }, { docId: "adj-1", amount: D("49.95") }]),
    receipt: model("receipt", () => RECEIPTS),
    warranty: model("warranty", () => WARRANTIES),
    warrantyClaim: model("warrantyClaim", () => OPEN_CLAIMS),
    saleItem: {
      aggregate: async (args: FindManyArgs & { _sum: Row }) => {
        calls.push({ model: "saleItem.aggregate", args });
        const lineDiscount = SALES.flatMap((sale) => sale.items as Row[])
          .reduce((sum, item) => sum.plus(item.lineDiscount as Prisma.Decimal), D(0));
        return { _sum: { lineDiscount } };
      },
    },
    siteContent: { findUnique: async () => { registrationReads += 1; return { value: "2026-09-01" }; } },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
      const sql = Prisma.sql(strings, ...values).text;
      rawQueries.push(sql);
      if (sql.includes("WITH base AS")) return [STOCK_ROW];
      if (sql.includes("STOCK_VALUE_RESIDUAL")) return [{ total: D("55.50") }];
      if (sql.includes("PURCHASE_ALLOWANCE")) return [{ total: D("-12.25") }];
      throw new Error(`unexpected raw query: ${sql}`);
    },
  };
  await mock.module("@/lib/db", { namedExports: { db } });
  reports = await import("@/lib/reports");
  ReportsContent = (await import("@/app/admin/(protected)/reports/ReportsContent")).default;
});

beforeEach(() => {
  calls.length = 0;
  rawQueries.length = 0;
  registrationReads = 0;
});

const FILTERS: ParsedReportFilters = {
  from: day("2026-11-01"), to: parseDateOnlyToEndOfDay("2026-11-30"), fromInput: "2026-11-01", toInput: "2026-11-30",
  customerCodeFrom: "", customerCodeTo: "", supplierCodeFrom: "", supplierCodeTo: "", productCodeFrom: "", productCodeTo: "",
  expenseCodeFrom: "", expenseCodeTo: "",
};

/** The sections ReportsContent renders, taken from the full result in the same key order. */
function renderedSections(full: ReportsFullData): ReportsData {
  const { totalInvoices, grossSalesAmount, returnAmount, netSaleAmount, lineDiscountTotal } = full.salesSummary;
  return {
    range: full.range, filters: full.filters,
    salesSummary: { totalInvoices, grossSalesAmount, returnAmount, netSaleAmount, lineDiscountTotal },
    stock: full.stock, openClaims: full.openClaims, receivables: full.receivables, payables: full.payables,
    suppliers: full.suppliers, customers: full.customers, dailyReceipts: full.dailyReceipts, dailyPayments: full.dailyPayments,
  };
}

const withoutLineDiscount = (data: ReportsData): unknown =>
  JSON.parse(JSON.stringify({ ...data, salesSummary: { ...data.salesSummary, lineDiscountTotal: null } }));

for (const [label, filters] of [
  ["no code filter", FILTERS],
  ["product, customer and supplier ranges", { ...FILTERS, productCodeFrom: "A001", productCodeTo: "A009",
    customerCodeFrom: "C001", customerCodeTo: "C999", supplierCodeFrom: "S001", supplierCodeTo: "S001" }],
] as const) {
  test(`summary scope equals the full report's rendered sections and HTML (${label})`, { skip: moduleMocksUnavailable }, async () => {
    const full = await reports.getReportsData(filters);
    const summary = await reports.getReportsSummaryData(filters);

    assert.deepEqual(Object.keys(summary), Object.keys(renderedSections(full)), "same sections, same order");
    assert.deepEqual(withoutLineDiscount(summary), withoutLineDiscount(renderedSections(full)));
    assert.equal(summary.salesSummary.lineDiscountTotal.toFixed(2), full.salesSummary.lineDiscountTotal.toFixed(2));
    assert.ok(Math.abs(summary.salesSummary.lineDiscountTotal - full.salesSummary.lineDiscountTotal) < 1e-9);
    assert.equal(summary.salesSummary.lineDiscountTotal, 10.45);

    for (const compact of [false, true]) {
      assert.equal(
        renderToStaticMarkup(createElement(ReportsContent, { data: summary, compact })),
        renderToStaticMarkup(createElement(ReportsContent, { data: full, compact })),
        `ReportsContent compact=${compact}`,
      );
    }
  });
}

test("summary scope skips the reads only the P&L, warranty and expense sections used", { skip: moduleMocksUnavailable }, async () => {
  await reports.getReportsSummaryData({ ...FILTERS, productCodeFrom: "A001", productCodeTo: "A009" });
  const summaryCalls = [...calls];
  const summaryRaw = [...rawQueries];
  assert.equal(registrationReads, 0, "no VAT registration read");
  assert.equal(summaryCalls.filter((call) => call.model === "warranty").length, 0, "no expiring-warranty read");
  assert.ok(summaryRaw.every((sql) => !sql.includes("FactProfit")), "no FactProfit variance sums");

  const salesCall = summaryCalls.find((call) => call.model === "sale" && !("amountRemain" in (call.args.where ?? {})));
  assert.ok(salesCall && !("items" in (salesCall.args.select ?? {})), "sale lines are not loaded");
  const creditCall = summaryCalls.find((call) => call.model === "creditNote");
  assert.ok(creditCall && !("items" in (creditCall.args.select ?? {})) && !("sale" in (creditCall.args.select ?? {})));
  assert.equal(summaryCalls.find((call) => call.model === "purchaseReturn")?.args.select?.purchase, false);
  const debitCall = summaryCalls.find((call) => call.model === "supplierDebitNote" && call.args.select && "varianceAmount" in call.args.select);
  assert.equal(debitCall?.args.select?.items, false, "no DN variance lines with a product filter");

  const aggregate = summaryCalls.filter((call) => call.model === "saleItem.aggregate");
  assert.equal(aggregate.length, 1);
  assert.deepEqual(aggregate[0].args.where, { sale: salesCall?.args.where }, "same sales filter as the sales read");
  assert.deepEqual((aggregate[0].args as { _sum?: Row })._sum, { lineDiscount: true });

  await reports.getReportsData({ ...FILTERS, productCodeFrom: "A001", productCodeTo: "A009" });
  const fullCalls = calls.slice(summaryCalls.length);
  assert.equal(fullCalls.filter((call) => call.model === "saleItem.aggregate").length, 0, "the full scope still adds up the lines");
  assert.equal(registrationReads, 1);
  assert.equal(fullCalls.filter((call) => call.model === "warranty").length, 1);
});

test("the full report keeps its P&L, warranty, expense and per-period sections", { skip: moduleMocksUnavailable }, async () => {
  const full = await reports.getReportsData(FILTERS);
  assert.deepEqual(Object.keys(full), ["range", "filters", "salesSummary", "profitLoss", "stock", "warranties", "openClaims",
    "receivables", "payables", "suppliers", "customers", "expenses", "dailyReceipts", "dailyPayments"]);
  assert.deepEqual(Object.keys(full.salesSummary), ["totalInvoices", "grossSalesAmount", "returnAmount", "netSaleAmount",
    "lineDiscountTotal", "byDay", "byWeek", "byMonth"]);
  assert.equal(full.profitLoss.purchaseCostVariance, 30 - 12.25);
  assert.equal(full.profitLoss.stockValueResidual, 55.5);
  assert.equal(full.warranties.expiringItems.length, 1);
  assert.equal(full.expenses.items.length, 2);
  assert.match(reports.buildReportsCsv(full), /กำไรขาดทุน/);
});
