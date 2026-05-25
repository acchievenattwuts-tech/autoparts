import assert from "node:assert/strict";

import {
  aggregateProductSearchLogClusters,
  classifyProductSearchCandidateAction,
  getProductSearchQualityBucket,
} from "../lib/product-search-log-analysis";

assert.equal(getProductSearchQualityBucket(0), "no-result");
assert.equal(getProductSearchQualityBucket(2), "low-result");

assert.equal(classifyProductSearchCandidateAction("คอมแอ"), "search-synonym");
assert.equal(classifyProductSearchCandidateAction("88804-0d090"), "product-alias-oem");
assert.equal(classifyProductSearchCandidateAction("vios 2012"), "fitment-year");
assert.equal(classifyProductSearchCandidateAction(""), "review-noise");

const clusters = aggregateProductSearchLogClusters([
  {
    query: "D-Max",
    resultCount: 0,
    source: "storefront",
    createdAt: new Date("2026-05-25T01:00:00.000Z"),
  },
  {
    query: "d-max",
    resultCount: 2,
    source: "admin",
    createdAt: new Date("2026-05-25T02:00:00.000Z"),
  },
  {
    query: "D Max",
    resultCount: 3,
    source: "storefront",
    createdAt: new Date("2026-05-25T02:30:00.000Z"),
  },
  {
    query: "คอมแอ",
    resultCount: 1,
    source: "storefront",
    createdAt: new Date("2026-05-25T03:00:00.000Z"),
  },
]);

assert.equal(clusters.length, 2);
assert.equal(clusters[0].normalizedQuery, "d-max");
assert.equal(clusters[0].count, 3);
assert.equal(clusters[0].bucket, "no-result");
assert.equal(clusters[0].candidateAction, "product-alias-oem");
assert.deepEqual(clusters[0].sourceCounts, { storefront: 2, admin: 1 });
assert.equal(clusters[1].normalizedQuery, "คอมแอ");
assert.equal(clusters[1].bucket, "low-result");

console.log("product search log analysis tests passed");
