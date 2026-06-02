import test from "node:test";
import assert from "node:assert/strict";

import { suggestAutoMappings } from "../services/mapping";
import type { ShopeeItemSummary } from "../services/products";

const products = [
  { id: "p1", code: "AC-001", name: "คอมเพรสเซอร์ A" },
  { id: "p2", code: "AC-002", name: "คอยล์เย็น B" },
  { id: "p3", code: "FILTER-9", name: "กรองแอร์" },
];

const noVariationItem: ShopeeItemSummary = {
  itemId: "1001",
  name: "Compressor",
  sku: "ac-001", // different case → should still match AC-001
  hasModel: false,
  models: [],
};

const variationItem: ShopeeItemSummary = {
  itemId: "1002",
  name: "Coil",
  sku: null,
  hasModel: true,
  models: [
    { modelId: "5001", sku: "AC-002", name: "รุ่น 1" },
    { modelId: "5002", sku: "UNKNOWN-SKU", name: "รุ่น 2" },
  ],
};

test("matches no-variation item by sku → modelId '0' (case-insensitive)", () => {
  const result = suggestAutoMappings([noVariationItem], products, []);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    itemId: "1001",
    modelId: "0",
    sku: "ac-001",
    productId: "p1",
    productCode: "AC-001",
    productName: "คอมเพรสเซอร์ A",
  });
});

test("matches variation models individually; skips non-matching skus", () => {
  const result = suggestAutoMappings([variationItem], products, []);
  assert.equal(result.length, 1);
  assert.equal(result[0].modelId, "5001");
  assert.equal(result[0].productId, "p2");
});

test("skips already-mapped item/model pairs", () => {
  const result = suggestAutoMappings([noVariationItem, variationItem], products, [
    { itemId: "1001", modelId: "0" },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].itemId, "1002");
});

test("returns empty when no skus match any product code", () => {
  const result = suggestAutoMappings(
    [{ itemId: "9", name: "X", sku: "NOPE", hasModel: false, models: [] }],
    products,
    [],
  );
  assert.equal(result.length, 0);
});
