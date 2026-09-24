import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// Review item #58: the stock-adjustment picker searches on demand for active,
// stock-tracked products and returns only the fields AdjustmentForm uses.

type FindManyArgs = {
  where: Record<string, unknown>;
  take: number;
  orderBy: unknown;
  select: Record<string, unknown>;
};
const findManyCalls: FindManyArgs[] = [];

const row = {
  id: "p1",
  code: "P0001",
  name: "คอมแอร์",
  costPrice: { toString: () => "1200.50", valueOf: () => 1200.5 },
  salePrice: { toString: () => "1500", valueOf: () => 1500 },
  isActive: true,
  isLotControl: true,
  requireExpiryDate: false,
  lotIssueMethod: "FIFO",
  category: { name: "คอมเพรสเซอร์" },
  brand: null,
  units: [
    { name: "ชิ้น", scale: { valueOf: () => 1 }, isBase: true },
    { name: "กล่อง", scale: { valueOf: () => 12 }, isBase: false },
  ],
};

before(async () => {
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        product: {
          findMany: async (args: FindManyArgs) => {
            findManyCalls.push(args);
            return [row];
          },
        },
      },
    },
  });
});

beforeEach(() => {
  findManyCalls.length = 0;
});

test("searches only active TRACKED products, 20 rows max, across the picker's match fields", async () => {
  const { searchAdjustmentProductOptions } = await import("@/lib/adjustment-product-search");
  await searchAdjustmentProductOptions("  คอม  ");
  const [call] = findManyCalls;
  assert.equal(call.take, 20);
  assert.equal(call.where.isActive, true);
  assert.equal(call.where.inventoryTracking, "TRACKED");
  const contains = { contains: "คอม", mode: "insensitive" };
  assert.deepEqual(call.where.OR, [
    { code: contains },
    { name: contains },
    { description: contains },
    { category: { name: contains } },
    { brand: { name: contains } },
    { aliases: { some: { alias: contains } } },
  ]);
  // Nothing the form does not use: no description, aliases or stock.
  assert.deepEqual(Object.keys(call.select).sort(), [
    "brand", "category", "code", "costPrice", "id", "isActive", "isLotControl",
    "lotIssueMethod", "name", "requireExpiryDate", "salePrice", "units",
  ]);
});

test("maps decimals/units exactly like the old page did (numbers, base unit first)", async () => {
  const { searchAdjustmentProductOptions } = await import("@/lib/adjustment-product-search");
  const [option] = await searchAdjustmentProductOptions("P0001");
  assert.deepEqual(option, {
    id: "p1",
    code: "P0001",
    name: "คอมแอร์",
    categoryName: "คอมเพรสเซอร์",
    brandName: null,
    costPrice: 1200.5,
    salePrice: 1500,
    isActive: true,
    isLotControl: true,
    requireExpiryDate: false,
    lotIssueMethod: "FIFO",
    units: [
      { name: "ชิ้น", scale: 1, isBase: true },
      { name: "กล่อง", scale: 12, isBase: false },
    ],
  });
  assert.deepEqual(findManyCalls[0]?.select.units, {
    select: { name: true, scale: true, isBase: true },
    orderBy: { isBase: "desc" },
  });
});

test("queries shorter than 3 characters do not hit the database", async () => {
  const { searchAdjustmentProductOptions } = await import("@/lib/adjustment-product-search");
  assert.deepEqual(await searchAdjustmentProductOptions("ab "), []);
  assert.equal(findManyCalls.length, 0);
});
