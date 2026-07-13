import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductAliasSearchText,
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

test("compact alias search text preserves alias-array search results", () => {
  const aliases = ["Old Condenser", "คอนเดนเซอร์ รุ่นเก่า", "ABC-123"];
  const compactProducts = products.map((product) => ({
    ...product,
    aliasSearchText: buildProductAliasSearchText(product.aliases),
    aliases: undefined,
  }));

  for (const query of ["old", "CONDENSER", "รุ่น", "abc-1", "not-found"]) {
    assert.deepEqual(
      filterProductSearchOptions(compactProducts, query, 50).map((product) => product.id),
      filterProductSearchOptions(products, query, 50).map((product) => product.id),
    );
  }

  const aliasOnly = [{
    id: "alias-only",
    code: "ZZZ",
    name: "No direct match",
    categoryName: "Other",
    aliases,
  }];
  const compactAliasOnly = [{
    ...aliasOnly[0],
    aliases: undefined,
    aliasSearchText: buildProductAliasSearchText(aliases),
  }];
  for (const query of ["condenser", "รุ่นเก่า", "ABC-123"]) {
    assert.deepEqual(
      filterProductSearchOptions(compactAliasOnly, query, 50).map((product) => product.id),
      filterProductSearchOptions(aliasOnly, query, 50).map((product) => product.id),
    );
  }
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
