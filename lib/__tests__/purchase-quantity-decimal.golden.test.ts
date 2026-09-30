import assert from "node:assert/strict";
import test, { before, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate } from "@/lib/th-date";

// ก5: PurchaseItem.quantity changed from Int to Decimal(12,4). Prisma now hands every reader a
// Decimal (also while the column is still int4 during the deploy window). The purchase
// register rows and CSV must be byte-identical for integer quantities, and a fractional
// purchase must come out as a plain number, printed with 2 decimals.

type QuantityValue = number | Prisma.Decimal;

const date = parseDateOnlyToDate("2026-09-30");
const mocksUnavailable = typeof (mock as { module?: unknown }).module !== "function" && "requires module mocks";

function makePurchase(quantity: QuantityValue, showQty: QuantityValue | null) {
  return {
    purchaseNo: "RRC26093000001", purchaseDate: date, purchaseType: "CREDIT_PURCHASE", paymentMethod: null,
    cashBankAccountId: null, referenceNo: "INV-1", vatType: "NO_VAT", vatAmount: 0, subtotalAmount: 3075,
    cashBankAccount: null, status: "ACTIVE", supplier: { code: "S001", name: "ผู้จำหน่าย" },
    items: [{
      quantity, costPrice: 150, subtotalAmount: 3075, totalAmount: 3075, showQty,
      showUnitName: showQty === null ? null : "ลิตร", showPricePerUnit: showQty === null ? null : 150,
      product: { code: "OIL-1", name: "น้ำมันเครื่อง", purchaseUnitName: "ลิตร" },
    }],
  };
}

let purchase = makePurchase(3, null);
let reportQueries: typeof import("@/lib/report-queries");

before(async () => {
  if (mocksUnavailable) return;
  await mock.module("@/lib/db", { namedExports: { db: {
    purchase: { findMany: async () => [purchase] },
    documentPayment: { findMany: async () => [] },
  } } });
  reportQueries = await import("@/lib/report-queries");
});

const REPORT_FILTERS = { from: date, to: date, fromStr: "2026-09-30", toStr: "2026-09-30", hasFilter: true, showCancelled: false };

async function snapshot(quantity: QuantityValue, showQty: QuantityValue | null): Promise<string> {
  purchase = makePurchase(quantity, showQty);
  const rows = await reportQueries.queryPurchaseRows(REPORT_FILTERS, null);
  return JSON.stringify({ rows, csv: reportQueries.buildPurchasesCsv(rows) });
}

test("integer purchase quantities read as Decimals give byte-identical register rows and CSV", { skip: mocksUnavailable }, async () => {
  // A line without display fields reports the base quantity itself.
  const before = await snapshot(3, null);
  assert.equal(await snapshot(new Prisma.Decimal(3), null), before, "int4 column read through the Decimal field");
  assert.equal(await snapshot(new Prisma.Decimal("3.0000"), null), before, "numeric(12,4) column");
  // A line with display fields reports showQty, unchanged.
  const withDisplay = await snapshot(24, 2);
  assert.equal(await snapshot(new Prisma.Decimal("24.0000"), new Prisma.Decimal("2.0000")), withDisplay);
  const parsed = JSON.parse(before) as { rows: Array<{ qty: unknown }>; csv: string };
  assert.equal(parsed.rows[0].qty, 3);
  assert.ok(parsed.csv.includes(",OIL-1,น้ำมันเครื่อง,3,ลิตร,"));
});

test("a fractional purchase (20.5 base units) reaches the report as a number and prints 2 decimals", { skip: mocksUnavailable }, async () => {
  purchase = makePurchase(new Prisma.Decimal("20.5000"), null);
  const [row] = await reportQueries.queryPurchaseRows(REPORT_FILTERS, null);
  assert.equal(typeof row.qty, "number");
  assert.equal(row.qty, 20.5);
  assert.ok(reportQueries.buildPurchasesCsv([row]).includes(",OIL-1,น้ำมันเครื่อง,20.50,ลิตร,"));
});
