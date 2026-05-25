import assert from "node:assert/strict";

import {
  buildProductSearchReviewOutcomeKey,
  isProductSearchReviewStatus,
  PRODUCT_SEARCH_REVIEW_STATUSES,
} from "../lib/product-search-review-outcome";

assert.deepEqual(PRODUCT_SEARCH_REVIEW_STATUSES, [
  "pending",
  "applied",
  "ignored",
  "needs-investigation",
  "duplicate",
]);

assert.equal(isProductSearchReviewStatus("pending"), true);
assert.equal(isProductSearchReviewStatus("needs-investigation"), true);
assert.equal(isProductSearchReviewStatus("needs_investigation"), false);
assert.equal(isProductSearchReviewStatus(""), false);

const key = buildProductSearchReviewOutcomeKey({
  normalizedQuery: " D-Max ",
  candidateAction: "product-alias-oem",
});
assert.deepEqual(key, {
  normalizedQuery: "d-max",
  candidateAction: "product-alias-oem",
});

console.log("product search review outcome tests passed");
