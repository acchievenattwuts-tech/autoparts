import assert from "node:assert/strict";
import test, { before, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate } from "@/lib/th-date";

// E7: SaleItem.quantity changed from Int to Decimal(12,4). Prisma now hands every reader a
// Decimal (also while the column is still int4 during the deploy window). These goldens
// prove that (a) an integer quantity read as a Decimal yields byte-identical profit facts,
// reports, sales-register rows and CSV compared to the old plain number, and (b) a
// fractional sale is costed exactly: 0.4 x 200 with cost 150 -> cost 60, gross profit 20.

type QuantityValue = number | Prisma.Decimal;

const date = parseDateOnlyToDate("2026-09-30");
const mocksUnavailable = typeof (mock as { module?: unknown }).module !== "function" && "requires module mocks";

function makeSale(quantity: QuantityValue, line: { salePrice: number; costPrice: number; totalAmount: number }) {
  return {
    id: "sale-1", saleNo: "SA2609300001", saleDate: date, status: "ACTIVE" as "ACTIVE" | "CANCELLED",
    channel: "STORE", channelRefNo: null, trackingNo: null, shippingStatus: "PENDING", saleType: "RETAIL",
    paymentType: "CASH_SALE", paymentMethod: "CASH", vatType: "NO_VAT", vatRate: 0,
    totalAmount: line.totalAmount, subtotalAmount: line.totalAmount, vatAmount: 0, netAmount: line.totalAmount,
    discount: 0, shippingFee: 0, amountRemain: 0, customer: { code: "C001", name: "ลูกค้า" },
    customerName: "ลูกค้า", customerId: "cust-1", note: null, cashBankAccount: { name: "เงินสด" },
    shopeeOrderImport: null,
    items: [{
      id: "item-1", productId: "oil-1", quantity, salePrice: line.salePrice, costPrice: line.costPrice,
      totalAmount: line.totalAmount, subtotalAmount: line.totalAmount, lineDiscount: 0,
      supplierId: null, supplierName: null,
      product: { code: "OIL-1", name: "น้ำมันเครื่อง", saleUnitName: "ลิตร" },
    }],
  };
}

function makeReturn(quantity: QuantityValue) {
  return {
    id: "cn-1", cnNo: "CN2609300001", cnDate: date, status: "ACTIVE", type: "RETURN", channel: null,
    totalAmount: 200, subtotalAmount: 200, vatAmount: 0, customerId: "cust-1", customer: null, customerName: "ลูกค้า",
    saleId: "sale-1", settlementType: "CREDIT_DEBT", refundMethod: null, cashBankAccount: null, note: null,
    // Legacy return without saleItemId: its cost comes from the weighted sale-line cost map.
    sale: { saleNo: "SA2609300001", channel: "STORE", items: [
      { id: "item-1", productId: "oil-1", quantity, costPrice: 150 },
      { id: "item-2", productId: "oil-1", quantity, costPrice: 170 },
    ] },
    items: [{ id: "cn-item-1", saleItemId: null, productId: "oil-1", qty: 1, amount: 200, unitPrice: 200,
      stockDisposition: "RESTOCK", product: { code: "OIL-1", name: "น้ำมันเครื่อง", avgCost: 999 } }],
  };
}

let sale = makeSale(3, { salePrice: 200, costPrice: 150, totalAmount: 600 });
let creditNotes: ReturnType<typeof makeReturn>[] = [];
let rows: Prisma.FactProfitCreateInput[] = [];
let facts: typeof import("@/lib/profit-fact");
let reports: typeof import("@/lib/reports");
let reportQueries: typeof import("@/lib/report-queries");

before(async () => {
  if (mocksUnavailable) return;
  const empty = { findMany: async () => [] };
  await mock.module("@/lib/db", { namedExports: { db: {
    sale: { findMany: async (args: { select: { items?: unknown } }) => args.select.items ? [sale] : [] },
    expense: empty, creditNote: { findMany: async () => creditNotes }, supplierDebitNote: empty,
    purchase: empty, purchaseReturn: empty, supplierAdvance: empty, customerAdvance: empty,
    supplierAdvanceRefund: empty, customerAdvanceRefund: empty, supplierPayment: empty, warranty: empty,
    warrantyClaim: empty, receipt: empty, $queryRaw: async () => [],
  } } });
  facts = await import("@/lib/profit-fact");
  reports = await import("@/lib/reports");
  reportQueries = await import("@/lib/report-queries");
});

function fakeTx(): Parameters<typeof facts.rebuildSaleProfitFacts>[0] {
  return { sale: { findUnique: async () => sale }, creditNote: { findUnique: async () => creditNotes[0] },
    factProfit: { updateMany: async () => { rows = []; return { count: 0 }; },
      aggregate: async () => ({ _max: { versionNo: 1 } }),
      create: async ({ data }: { data: Prisma.FactProfitCreateInput }) => { rows.push(data); return data; } },
  } as unknown as Parameters<typeof facts.rebuildSaleProfitFacts>[0];
}

async function getReport() {
  return reports.getReportsData({ from: date, to: date, fromInput: "2026-09-30", toInput: "2026-09-30",
    customerCodeFrom: "", customerCodeTo: "", supplierCodeFrom: "", supplierCodeTo: "", productCodeFrom: "",
    productCodeTo: "", expenseCodeFrom: "", expenseCodeTo: "" });
}

const REPORT_FILTERS = { from: date, to: date, fromStr: "2026-09-30", toStr: "2026-09-30", hasFilter: true, showCancelled: false };

/** Every quantity-derived output, serialized the way it leaves the server (JSON / CSV text). */
async function snapshotOutputs(quantity: QuantityValue): Promise<string> {
  sale = makeSale(quantity, { salePrice: 200, costPrice: 150, totalAmount: 600 });
  creditNotes = [makeReturn(quantity)];
  await facts.rebuildSaleProfitFacts(fakeTx(), sale.id);
  const saleFacts = rows;
  await facts.rebuildCreditNoteProfitFacts(fakeTx(), "cn-1");
  const returnFacts = rows;
  const report = await getReport();
  const salesRows = await reportQueries.querySalesRows(REPORT_FILTERS, null);
  const csv = reportQueries.buildSalesCsv(salesRows);
  return JSON.stringify({ saleFacts, returnFacts, profitLoss: report.profitLoss, salesSummary: report.salesSummary,
    salesRows, csv });
}

test("integer quantity read as a Decimal gives byte-identical facts, reports, register rows and CSV", { skip: mocksUnavailable }, async () => {
  const before = await snapshotOutputs(3);
  assert.equal(await snapshotOutputs(new Prisma.Decimal(3)), before, "int4 column read through the Decimal field");
  assert.equal(await snapshotOutputs(new Prisma.Decimal("3.0000")), before, "numeric(12,4) column");
  const parsed = JSON.parse(before) as { csv: string; salesRows: Array<{ qty: unknown }> };
  assert.equal(parsed.salesRows[0].qty, 3);
  assert.ok(parsed.csv.includes(",OIL-1,น้ำมันเครื่อง,3,ลิตร,"));
});

test("sales register rows hand plain numbers to the page and the Excel/CSV exports", { skip: mocksUnavailable }, async () => {
  sale = makeSale(new Prisma.Decimal("0.4"), { salePrice: 200, costPrice: 150, totalAmount: 80 });
  const [row] = await reportQueries.querySalesRows(REPORT_FILTERS, null);
  assert.equal(typeof row.qty, "number");
  assert.equal(row.qty, 0.4);
  assert.ok(reportQueries.buildSalesCsv([row]).includes(",OIL-1,น้ำมันเครื่อง,0.40,ลิตร,"));
});

test("fractional sale: 0.4 base units at 200 with cost 150 -> cost 60, gross profit 20", { skip: mocksUnavailable }, async () => {
  sale = makeSale(new Prisma.Decimal("0.4000"), { salePrice: 200, costPrice: 150, totalAmount: 80 });
  creditNotes = [];
  await facts.rebuildSaleProfitFacts(fakeTx(), sale.id);
  assert.equal(rows.length, 1);
  const [fact] = rows;
  assert.equal(String(fact.quantity), "0.4");
  assert.equal(Number(fact.salesAmountExVat), 80);
  assert.equal(Number(fact.costAmount), 60);
  assert.equal(Number(fact.grossProfit), 20);
  assert.equal(Number(fact.unitSalePrice), 200);
  assert.equal(Number(fact.unitCostPrice), 150);
  assert.equal(Number(fact.unitProfit), 50);
  assert.equal(Number(fact.marginPct), 25);

  const report = await getReport();
  assert.equal(report.profitLoss.costOfGoodsSold, 60);
  assert.equal(report.profitLoss.grossProfit, 20);
});
