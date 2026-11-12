import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

/**
 * R11 (review 2026-11-12): when every product line of the report's bills is already on screen
 * (canReuseVisibleFacts), the discount breakdown used to read the same SaleItem rows a second time.
 * It now reuses the first read. The totals and rows must be exactly what the previous code returned
 * for this fixture (pinned below), with one SaleItem read instead of two; with a product filter the
 * complete-line read still runs as before.
 */
const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" && "requires --experimental-test-module-mocks";

const saleDate = new Date("2026-11-05T00:00:00+07:00");
const facts = [
  { sourceType: "SALE", sourceSubtype: null, sourceId: "sale-1", sourceLineId: "line-1", sourceDocNo: "IV2611050001",
    referenceDocNo: null, businessDate: saleDate, customerName: "ลูกค้าทดสอบ", channel: "STORE", productCode: "A001",
    productName: "สินค้า A", quantity: 3, salesAmountIncVat: 285.3, salesAmountExVat: 266.64, costAmount: 150, grossProfit: 116.64 },
  { sourceType: "SALE", sourceSubtype: null, sourceId: "sale-1", sourceLineId: "line-2", sourceDocNo: "IV2611050001",
    referenceDocNo: null, businessDate: saleDate, customerName: "ลูกค้าทดสอบ", channel: "STORE", productCode: "B001",
    productName: "สินค้า B", quantity: 1, salesAmountIncVat: 47.7, salesAmountExVat: 44.58, costAmount: 30.1, grossProfit: 14.48 },
  { sourceType: "SALE", sourceSubtype: null, sourceId: "sale-2", sourceLineId: "line-3", sourceDocNo: "IV2611050002",
    referenceDocNo: null, businessDate: saleDate, customerName: null, channel: null, productCode: "C001",
    productName: "สินค้า C", quantity: 2, salesAmountIncVat: 0.3, salesAmountExVat: 0.28, costAmount: 0.1, grossProfit: 0.18 },
];
const saleItems = [
  { id: "line-1", quantity: 3, showQty: 1.5, showUnitName: "คู่", unitListPrice: 110.1, lineDiscount: 0.15, totalAmount: 300.3,
    sale: { vatType: "INCLUDING_VAT" } },
  { id: "line-2", quantity: 1, showQty: null, showUnitName: "ชิ้น", unitListPrice: 50.2, lineDiscount: 0.2, totalAmount: 50.2,
    sale: { vatType: "INCLUDING_VAT" } },
  { id: "line-3", quantity: 2, showQty: null, showUnitName: "ชิ้น", unitListPrice: 0.1, lineDiscount: 0.1, totalAmount: 0.3,
    sale: { vatType: "EXCLUDING_VAT" } },
];

type FindManyArgs = { where?: { id?: { in?: string[] }; productId?: unknown }; select?: Record<string, unknown> };
const saleItemReads: string[][] = [];

let reportModule: typeof import("@/lib/sales-line-profit-report");

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        product: { findMany: async () => [{ id: "product-a" }, { id: "product-b" }, { id: "product-c" }] },
        factProfit: {
          groupBy: async (args: { by: string[] }) => (args.by.includes("sourceDocNo")
            ? [
                { sourceType: "SALE", sourceSubtype: null, sourceId: "sale-1", sourceDocNo: "IV2611050001", referenceDocNo: null,
                  businessDate: saleDate, customerName: "ลูกค้าทดสอบ", channel: "STORE",
                  _sum: { quantity: 4, salesAmountIncVat: 333, salesAmountExVat: 311.22, costAmount: 180.1, grossProfit: 131.12 } },
                { sourceType: "SALE", sourceSubtype: null, sourceId: "sale-2", sourceDocNo: "IV2611050002", referenceDocNo: null,
                  businessDate: saleDate, customerName: null, channel: null,
                  _sum: { quantity: 2, salesAmountIncVat: 0.3, salesAmountExVat: 0.28, costAmount: 0.1, grossProfit: 0.18 } },
              ]
            : [{ sourceType: "SALE", sourceId: "sale-1" }, { sourceType: "SALE", sourceId: "sale-2" }]),
          aggregate: async (args: { where?: { productId?: unknown } }) => (args.where?.productId === null
            ? { _sum: { salesAmountIncVat: 0 } }
            : { _sum: { salesAmountIncVat: 333.3, salesAmountExVat: 311.5, costAmount: 180.2, grossProfit: 131.3 } }),
          count: async () => facts.length,
          findMany: async (args: FindManyArgs) => (args.where?.productId && typeof args.where.productId === "object"
            && "in" in args.where.productId ? facts.slice(0, 1) : facts),
        },
        sale: { findMany: async () => [{ id: "sale-1", discount: 20.5 }, { id: "sale-2", discount: 0 }] },
        saleItem: {
          findMany: async (args: FindManyArgs) => {
            const ids = args.where?.id?.in ?? [];
            saleItemReads.push([...ids]);
            const wanted = new Set(ids);
            return saleItems.filter((item) => wanted.has(item.id));
          },
        },
        creditNoteItem: { findMany: async () => [] },
      },
    },
  });
  reportModule = await import("@/lib/sales-line-profit-report");
});

beforeEach(() => {
  saleItemReads.length = 0;
});

test("complete visible lines reuse the first SaleItem read and keep every total and row", { skip: moduleMocksUnavailable }, async () => {
  const filters = reportModule.parseSalesLineProfitFilters({ from: "2026-11-01", to: "2026-11-30" });
  const data = await reportModule.querySalesLineProfitData(filters);
  assert.deepEqual(saleItemReads, [["line-1", "line-2", "line-3"]], "one SaleItem read (two before)");
  assert.deepEqual(data.totals, {
    amountBeforeLineDiscount: 215.55, lineDiscount: 0.45, amountAfterLineDiscount: 350.8, allocatedBillDiscount: 17.52,
    shippingAmountIncVat: 0, netSalesIncVat: 333.3, netSalesExVat: 311.5, costAmount: 180.2, grossProfit: 131.3,
    marginPct: (131.3 / 311.5) * 100,
  });
  assert.deepEqual(data.lines.map((line) => [line.sourceLineId, line.quantity, line.unitName, line.lineDiscount,
    line.amountBeforeLineDiscount, line.allocatedBillDiscount]), [
    ["line-1", 1.5, "คู่", 0.15, 165.15, 15],
    ["line-2", 1, "ชิ้น", 0.2, 50.2, 2.5],
    ["line-3", 2, "ชิ้น", 0.1, 0.2, 0.02],
  ]);
});

test("a product filter still reads the complete product lines separately", { skip: moduleMocksUnavailable }, async () => {
  const filters = reportModule.parseSalesLineProfitFilters({ from: "2026-11-01", to: "2026-11-30", productIds: "product-a" });
  await reportModule.querySalesLineProfitData(filters);
  assert.equal(saleItemReads.length, 2);
});
