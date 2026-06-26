import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOutOfStockProductsHref,
  buildOutOfStockProductsWhere,
} from "../app/admin/(protected)/workboard/out-of-stock-products";

test("workboard out-of-stock product query matches active tracked non-positive stock products", () => {
  assert.deepEqual(buildOutOfStockProductsWhere(), {
    isActive: true,
    inventoryTracking: "TRACKED",
    stock: { lte: 0 },
  });
});

test("workboard out-of-stock card links to products with the same filters", () => {
  assert.equal(
    buildOutOfStockProductsHref(),
    "/admin/products?stockStatus=out_of_stock&statusFilter=active&trackingFilter=tracked",
  );
});
