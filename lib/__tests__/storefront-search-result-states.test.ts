import test from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_SEARCH_RESULT,
  RATE_LIMITED_SEARCH_RESULT,
  shouldReplaceShownResults,
} from "@/lib/storefront-search-result-states";

// Golden suite for the rule that storefront search must never imply the shop
// has no such part when it simply declined to run the query. Both payloads
// carry zero products, so only the flag separates "we looked and found nothing"
// from "we did not look".

test("a genuine empty result is allowed to replace what is on screen", () => {
  assert.equal(shouldReplaceShownResults(EMPTY_SEARCH_RESULT), true);
});

test("a throttled result must not replace what is on screen", () => {
  assert.equal(shouldReplaceShownResults(RATE_LIMITED_SEARCH_RESULT), false);
});

// If these two ever became indistinguishable, the throttled path would render
// through the "ไม่พบสินค้าที่ค้นหา" empty state and read as out of stock.
test("throttled and empty are distinguishable despite identical product data", () => {
  assert.deepEqual(RATE_LIMITED_SEARCH_RESULT.products, EMPTY_SEARCH_RESULT.products);
  assert.equal(RATE_LIMITED_SEARCH_RESULT.total, EMPTY_SEARCH_RESULT.total);
  assert.notEqual(
    shouldReplaceShownResults(RATE_LIMITED_SEARCH_RESULT),
    shouldReplaceShownResults(EMPTY_SEARCH_RESULT),
  );
});

test("the empty result carries no rateLimited flag at all", () => {
  assert.equal(EMPTY_SEARCH_RESULT.rateLimited, undefined);
  assert.equal(RATE_LIMITED_SEARCH_RESULT.rateLimited, true);
});

// A stray `rateLimited: false` from some future call site must read as "this is
// a real result", not accidentally suppress the update.
test("an explicit false flag still counts as a replaceable result", () => {
  assert.equal(
    shouldReplaceShownResults({ ...EMPTY_SEARCH_RESULT, rateLimited: false }),
    true,
  );
});
