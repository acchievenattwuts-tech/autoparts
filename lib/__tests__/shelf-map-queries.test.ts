import assert from "node:assert/strict";
import test from "node:test";

import {
  buildShelfGridModel,
  buildShelfProductWhere,
  buildShelfResultProductWhere,
  findShelfGridCell,
  formatShelfBlockingList,
  formatShelfCellCategories,
  groupShelfProductsByCategory,
  type ShelfCellAggregateRow,
  type ShelfMapRack,
  type ShelfProductListItem,
} from "@/lib/shelf-map-queries";

const racks: ShelfMapRack[] = [
  { id: "rA", code: "A", name: "คอยล์เย็น", levels: 3 },
  { id: "rB", code: "B", name: null, levels: 1 },
  { id: "rC", code: "C", name: null, levels: 2 },
];

const categoryNames = new Map([
  ["c1", "คอยล์เย็น"],
  ["c2", "วาล์วแอร์"],
  ["c3", "ไดเออร์"],
]);

const aggregate = (row: Partial<ShelfCellAggregateRow> & Pick<ShelfCellAggregateRow, "rackId" | "level" | "categoryId">): ShelfCellAggregateRow => ({
  categoryTotal: 1,
  cellTotal: 1,
  cellInStock: 1,
  categoryGroups: 1,
  ...row,
});

const item = (id: string, categoryName: string): ShelfProductListItem => ({
  id,
  code: id.toUpperCase(),
  name: `สินค้า ${id}`,
  stock: 1,
  unitName: "ชิ้น",
  categoryName,
  brandName: null,
  locations: [],
  verifiedAt: null,
});

test("grid rows run from the tallest rack's top level down to level 1", () => {
  const model = buildShelfGridModel(racks, [], categoryNames);
  assert.deepEqual(
    model.rows.map((row) => row.level),
    [3, 2, 1],
  );
  assert.equal(model.cellCount, 6);
});

test("racks with fewer levels get a null placeholder above their top level", () => {
  const model = buildShelfGridModel(racks, [], categoryNames);
  const [top, middle, bottom] = model.rows;
  assert.deepEqual(
    top.cells.map((cell) => cell?.code ?? null),
    ["A-3", null, null],
  );
  assert.deepEqual(
    middle.cells.map((cell) => cell?.code ?? null),
    ["A-2", null, "C-2"],
  );
  assert.deepEqual(
    bottom.cells.map((cell) => cell?.code ?? null),
    ["A-1", "B-1", "C-1"],
  );
});

test("cell totals, stock state and top categories come from the aggregate rows", () => {
  const model = buildShelfGridModel(
    racks,
    [
      aggregate({ rackId: "rA", level: 2, categoryId: "c2", categoryTotal: 5, cellTotal: 19, cellInStock: 17, categoryGroups: 4 }),
      aggregate({ rackId: "rA", level: 2, categoryId: "c1", categoryTotal: 12, cellTotal: 19, cellInStock: 17, categoryGroups: 4 }),
      aggregate({ rackId: "rC", level: 1, categoryId: "c3", categoryTotal: 2, cellTotal: 2, cellInStock: 0, categoryGroups: 1 }),
    ],
    categoryNames,
  );
  const a2 = findShelfGridCell(model, "A", 2);
  assert.ok(a2);
  assert.equal(a2.total, 19);
  assert.equal(a2.inStock, 17);
  assert.deepEqual(a2.topCategories, [
    { name: "คอยล์เย็น", count: 12 },
    { name: "วาล์วแอร์", count: 5 },
  ]);
  assert.equal(a2.moreCategoryCount, 2);
  assert.equal(formatShelfCellCategories(a2), "คอยล์เย็น 12 · วาล์วแอร์ 5 · +2 หมวด");

  const c1 = findShelfGridCell(model, "C", 1);
  assert.ok(c1);
  assert.equal(c1.inStock, 0);
  assert.equal(model.matchedCellCount, 2);
  assert.equal(model.stockedCellCount, 1);

  const empty = findShelfGridCell(model, "B", 1);
  assert.ok(empty);
  assert.equal(empty.total, 0);
  assert.equal(formatShelfCellCategories(empty), "");
});

test("aggregates for unknown racks or missing levels are ignored, unknown categories are labelled", () => {
  const model = buildShelfGridModel(
    racks,
    [
      aggregate({ rackId: "gone", level: 1, categoryId: "c1" }),
      aggregate({ rackId: "rB", level: 2, categoryId: "c1" }),
      aggregate({ rackId: "rB", level: 1, categoryId: "deleted", categoryTotal: 3, cellTotal: 3 }),
    ],
    categoryNames,
  );
  assert.equal(model.matchedCellCount, 1);
  assert.equal(findShelfGridCell(model, "B", 2), null);
  assert.deepEqual(findShelfGridCell(model, "B", 1)?.topCategories, [{ name: "ไม่ระบุหมวด", count: 3 }]);
});

test("findShelfGridCell needs both a rack and a level on the map", () => {
  const model = buildShelfGridModel(racks, [], categoryNames);
  assert.equal(findShelfGridCell(model, "A", null), null);
  assert.equal(findShelfGridCell(model, "", 1), null);
  assert.equal(findShelfGridCell(model, "Z", 1), null);
  assert.equal(findShelfGridCell(model, "A", 9), null);
  assert.equal(findShelfGridCell(model, "C", 2)?.rackId, "rC");
});

test("an empty rack list gives an empty grid", () => {
  const model = buildShelfGridModel([], [], categoryNames);
  assert.deepEqual(model.rows, []);
  assert.equal(model.cellCount, 0);
});

test("products group by category, biggest group first, keeping item order", () => {
  const groups = groupShelfProductsByCategory([
    item("p1", "วาล์วแอร์"),
    item("p2", "คอยล์เย็น"),
    item("p3", "คอยล์เย็น"),
    item("p4", "ไดเออร์"),
  ]);
  assert.deepEqual(
    groups.map((group) => [group.categoryName, group.items.map((entry) => entry.id)]),
    [
      ["คอยล์เย็น", ["p2", "p3"]],
      ["ไดเออร์", ["p4"]],
      ["วาล์วแอร์", ["p1"]],
    ],
  );
});

test("blocking list names up to the loaded rows and counts the rest", () => {
  const items = [
    { productCode: "P001", locationCode: "A-5" },
    { productCode: "P002", locationCode: "A-4" },
  ];
  assert.equal(formatShelfBlockingList({ items, total: 2 }), "P001 (A-5), P002 (A-4)");
  assert.equal(formatShelfBlockingList({ items, total: 15 }), "P001 (A-5), P002 (A-4) และอีก 13 รายการ");
});

test("product filter: active only, optional id list and stock > 0", () => {
  assert.deepEqual(buildShelfProductWhere({ productIds: null, inStockOnly: false }), { isActive: true });
  assert.deepEqual(buildShelfProductWhere({ productIds: ["p1"], inStockOnly: true }), {
    isActive: true,
    id: { in: ["p1"] },
    stock: { gt: 0 },
  });
});

test("result filter: unlocated wins, primaryOnly only narrows location conditions", () => {
  const base = { productIds: null, inStockOnly: true, primaryOnly: true, rackId: null } as const;
  assert.deepEqual(buildShelfResultProductWhere({ ...base, location: "all" }), { isActive: true, stock: { gt: 0 } });
  assert.deepEqual(buildShelfResultProductWhere({ ...base, location: "unlocated", rackId: "rA" }), {
    isActive: true,
    stock: { gt: 0 },
    shelfLocations: { none: {} },
  });
  assert.deepEqual(buildShelfResultProductWhere({ ...base, location: "located" }), {
    isActive: true,
    stock: { gt: 0 },
    shelfLocations: { some: { isPrimary: true } },
  });
  assert.deepEqual(buildShelfResultProductWhere({ ...base, primaryOnly: false, location: "all", rackId: "rA" }), {
    isActive: true,
    stock: { gt: 0 },
    shelfLocations: { some: { rackId: "rA" } },
  });
});
