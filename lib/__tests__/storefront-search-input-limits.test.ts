import assert from "node:assert/strict";
import test from "node:test";
import {
  STOREFRONT_SEARCH_MAX_ID_LENGTH,
  STOREFRONT_SEARCH_MAX_LIST_ITEMS,
  STOREFRONT_SEARCH_MAX_PAGE,
  STOREFRONT_SEARCH_MAX_PRICE,
  STOREFRONT_SEARCH_MAX_QUERY_LENGTH,
  clampSearchList,
  clampSearchPage,
  clampSearchPrice,
  clampSearchText,
} from "@/lib/storefront-search-input-limits";

test("the ceilings match the search Server Action's Zod schema", () => {
  assert.equal(STOREFRONT_SEARCH_MAX_QUERY_LENGTH, 200);
  assert.equal(STOREFRONT_SEARCH_MAX_ID_LENGTH, 64);
  assert.equal(STOREFRONT_SEARCH_MAX_LIST_ITEMS, 50);
  assert.equal(STOREFRONT_SEARCH_MAX_PAGE, 500);
  assert.equal(STOREFRONT_SEARCH_MAX_PRICE, 99_999_999);
});

test("normal storefront input passes through unchanged", () => {
  assert.equal(clampSearchText("คอมแอร์ vigo", STOREFRONT_SEARCH_MAX_QUERY_LENGTH), "คอมแอร์ vigo");
  assert.equal(clampSearchText(undefined), undefined);
  assert.deepEqual(clampSearchList(["Toyota", "Honda"]), ["Toyota", "Honda"]);
  assert.equal(clampSearchPage(3), 3);
  assert.equal(clampSearchPrice(1500), 1500);
  assert.equal(clampSearchPrice(null), null);
});

test("oversized GET params are clamped instead of reaching the search engine", () => {
  assert.equal(clampSearchText("ก".repeat(5000), STOREFRONT_SEARCH_MAX_QUERY_LENGTH)?.length, 200);
  const many = Array.from({ length: 400 }, (_, index) => `model-${index}`);
  assert.equal(clampSearchList(many).length, 50);
  assert.equal(clampSearchList(["x".repeat(300)], STOREFRONT_SEARCH_MAX_ID_LENGTH)[0].length, 64);
  assert.equal(clampSearchPage(1_000_000_000_000), 500);
  assert.equal(clampSearchPrice(1e15), 99_999_999);
});
