import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

/**
 * R7 (review 2026-11-12): the stock-on-hand report loaded `take: 1000` products
 * BEFORE dropping zero-stock rows, so with 1,229 active products the last
 * categories vanished from the table, the total card and the CSV/Excel exports.
 * These tests pin the new behaviour: every product up to the cap is loaded, the
 * per-row figures are computed exactly as before, and reaching the cap is
 * reported instead of hidden.
 */

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type ProductRow = {
  id: string;
  code: string;
  name: string;
  stock: number;
  avgCost: number;
  reportUnitName: string | null;
  minStock: number | null;
  units: { name: string; scale: number; isBase: boolean }[];
  category: { name: string };
};

type FindManyArgs = { take?: number; where?: unknown; orderBy?: unknown };

let catalogue: ProductRow[] = [];
let ledger = new Map<string, { stock: number; avgCost: number }>();
const findManyCalls: FindManyArgs[] = [];
const balanceCalls: string[][] = [];

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        product: {
          findMany: async (args: FindManyArgs): Promise<ProductRow[]> => {
            findManyCalls.push(args);
            return typeof args.take === "number" ? catalogue.slice(0, args.take) : catalogue;
          },
        },
      },
    },
  });
  await mock.module("@/lib/stock-card-latest-balance", {
    namedExports: {
      getLatestStockBalances: async (ids: string[]) => {
        balanceCalls.push(ids);
        return new Map(ids.filter((id) => ledger.has(id)).map((id) => [id, ledger.get(id)!]));
      },
    },
  });
});

beforeEach(() => {
  findManyCalls.length = 0;
  balanceCalls.length = 0;
});

function buildCatalogue(count: number): ProductRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    code: `P${String(index).padStart(4, "0")}`,
    name: `สินค้า ${index}`,
    stock: index % 10 === 0 ? 0 : 2,
    avgCost: 100 + index,
    reportUnitName: index % 7 === 0 ? "กล่อง" : null,
    minStock: 1,
    units: index % 7 === 0
      ? [{ name: "ชิ้น", scale: 1, isBase: true }, { name: "กล่อง", scale: 10, isBase: false }]
      : [{ name: "ชิ้น", scale: 1, isBase: true }],
    category: { name: index < 1_000 ? "คอยล์เย็น" : "หม้อน้ำ" },
  }));
}

const filters = {
  from: new Date("2026-11-01T00:00:00+07:00"),
  to: new Date("2026-11-12T23:59:59+07:00"),
  fromStr: "2026-11-01",
  toStr: "2026-11-12",
  hasFilter: false,
  submitted: true,
};

test("all 1,229 active products are loaded, not only the first 1,000", { skip: moduleMocksUnavailable }, async () => {
  const { queryStockReport, STOCK_REPORT_MAX_PRODUCTS } = await import("@/lib/ar-ap-stock-report-queries");
  catalogue = buildCatalogue(1_229);
  ledger = new Map(catalogue.filter((_, index) => index % 3 !== 0).map((p) => [p.id, { stock: p.stock * 10, avgCost: 9.5 }]));

  const { rows, truncated } = await queryStockReport(filters);

  assert.equal(truncated, false);
  assert.equal(findManyCalls[0].take, STOCK_REPORT_MAX_PRODUCTS + 1);
  assert.equal(balanceCalls[0].length, 1_229);
  const expectedWithStock = catalogue.filter((p) => (ledger.get(p.id)?.stock ?? p.stock) > 0).length;
  assert.equal(rows.length, expectedWithStock);
  assert.ok(rows.some((row) => row.categoryName === "หม้อน้ำ"), "products after the 1,000th must be present");
});

test("each row keeps the same figures: ledger balance first, report unit conversion, value = qty x cost", { skip: moduleMocksUnavailable }, async () => {
  const { queryStockReport } = await import("@/lib/ar-ap-stock-report-queries");
  catalogue = buildCatalogue(30);
  ledger = new Map([
    ["p1", { stock: 7, avgCost: 120.5 }],
    ["p7", { stock: 40, avgCost: 12.25 }],
  ]);

  const { rows } = await queryStockReport(filters);
  const byId = new Map(rows.map((row) => [row.id, row]));

  // Ledger values win over Product.stock / avgCost.
  assert.deepEqual(byId.get("p1"), {
    id: "p1", code: "P0001", name: "สินค้า 1", categoryName: "คอยล์เย็น",
    stock: 7, avgCost: 120.5, stockValue: 7 * 120.5, minStock: 1, unitName: "ชิ้น",
  });
  // Report unit "กล่อง" (scale 10): 40 pieces = 4 boxes at 122.5 per box.
  assert.equal(byId.get("p7")?.unitName, "กล่อง");
  assert.equal(byId.get("p7")?.stock, 4);
  assert.equal(byId.get("p7")?.avgCost, 122.5);
  // No ledger row: falls back to Product.stock / avgCost.
  assert.equal(byId.get("p2")?.stock, 2);
  assert.equal(byId.get("p2")?.avgCost, 102);
  // Zero stock is still hidden unless showAll.
  assert.equal(byId.has("p10"), false);
  const showAll = await queryStockReport({ ...filters, showAll: true });
  assert.equal(showAll.rows.some((row) => row.id === "p10"), true);
});

test("reaching the cap is reported and never loads more than the cap", { skip: moduleMocksUnavailable }, async () => {
  const { queryStockReport, STOCK_REPORT_MAX_PRODUCTS } = await import("@/lib/ar-ap-stock-report-queries");
  catalogue = buildCatalogue(STOCK_REPORT_MAX_PRODUCTS + 25);
  ledger = new Map();

  const { rows, truncated } = await queryStockReport({ ...filters, showAll: true });

  assert.equal(truncated, true);
  assert.equal(rows.length, STOCK_REPORT_MAX_PRODUCTS);
  assert.equal(balanceCalls[0].length, STOCK_REPORT_MAX_PRODUCTS);
});

test("the exports get the same rows as the page", { skip: moduleMocksUnavailable }, async () => {
  const { queryStockReport, queryStockRows } = await import("@/lib/ar-ap-stock-report-queries");
  catalogue = buildCatalogue(1_229);
  ledger = new Map();

  assert.deepEqual(await queryStockRows(filters), (await queryStockReport(filters)).rows);
});
