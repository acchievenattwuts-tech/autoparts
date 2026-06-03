import test from "node:test";
import assert from "node:assert/strict";

import { buildProductPurchaseLastSnapshots } from "../product-purchase-last";

test("buildProductPurchaseLastSnapshots picks the latest active purchase row per product", () => {
  const olderDate = new Date("2026-05-01T00:00:00.000Z");
  const newerDate = new Date("2026-05-10T00:00:00.000Z");

  const snapshots = buildProductPurchaseLastSnapshots([
    {
      productId: "p1",
      purchaseDate: olderDate,
      purchaseNo: "RR001",
      lineNo: 1,
      id: "item-1",
      costPrice: 90,
      showPricePerUnit: 180,
      showUnitName: "กล่อง",
      productPurchaseUnitName: "ชิ้น",
    },
    {
      productId: "p1",
      purchaseDate: newerDate,
      purchaseNo: "RR002",
      lineNo: 1,
      id: "item-2",
      costPrice: 100,
      showPricePerUnit: 200,
      showUnitName: "แพ็ค",
      productPurchaseUnitName: "ชิ้น",
    },
  ]);

  assert.deepEqual(snapshots, [
    {
      productId: "p1",
      purchaseLastPrice: 200,
      purchaseLastDate: newerDate,
      purchaseUnitName: "แพ็ค",
    },
  ]);
});

test("buildProductPurchaseLastSnapshots falls back to base cost and product purchase unit", () => {
  const purchaseDate = new Date("2026-05-10T00:00:00.000Z");

  const snapshots = buildProductPurchaseLastSnapshots([
    {
      productId: "p1",
      purchaseDate,
      purchaseNo: "RR001",
      lineNo: 1,
      id: "item-1",
      costPrice: 125,
      showPricePerUnit: null,
      showUnitName: null,
      productPurchaseUnitName: "ชิ้น",
    },
  ]);

  assert.deepEqual(snapshots, [
    {
      productId: "p1",
      purchaseLastPrice: 125,
      purchaseLastDate: purchaseDate,
      purchaseUnitName: "ชิ้น",
    },
  ]);
});
