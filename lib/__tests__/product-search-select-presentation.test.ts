import assert from "node:assert/strict";
import test from "node:test";

import {
  filterProductSearchOptions,
  getProductSearchOptionState,
} from "@/lib/product-search-select-presentation";

const products = [
  {
    id: "active",
    code: "P0001",
    name: "Active compressor",
    description: null,
    categoryName: "Compressor",
    brandName: "Denso",
    aliases: [],
    isActive: true,
  },
  {
    id: "inactive",
    code: "P0002",
    name: "Inactive condenser",
    description: null,
    categoryName: "Condenser",
    brandName: null,
    aliases: ["old condenser"],
    isActive: false,
  },
];

test("product dropdown search keeps inactive matches visible", () => {
  assert.deepEqual(
    filterProductSearchOptions(products, "condenser", 50).map((product) => product.id),
    ["inactive"],
  );
});

test("product dropdown marks inactive options as disabled with inactive row styling", () => {
  const activeState = getProductSearchOptionState(products[0], false);
  const inactiveState = getProductSearchOptionState(products[1], false);

  assert.equal(activeState.disabled, false);
  assert.equal(activeState.badgeLabel, "ใช้งาน");
  assert.equal(activeState.badgeTone, "success");
  assert.match(activeState.rowClassName, /hover:/);

  assert.equal(inactiveState.disabled, true);
  assert.equal(inactiveState.badgeLabel, "ปิดใช้งาน");
  assert.equal(inactiveState.badgeTone, "danger");
  assert.match(inactiveState.rowClassName, /rose/);
  assert.match(inactiveState.rowClassName, /cursor-not-allowed/);
  assert.match(inactiveState.primaryTextClassName, /dark:text-rose-50/);
  assert.match(inactiveState.secondaryTextClassName, /dark:text-rose-100/);
  assert.match(inactiveState.codeTextClassName, /dark:text-rose-200/);
});
