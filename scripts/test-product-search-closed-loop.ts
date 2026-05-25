import assert from "node:assert/strict";

import {
  classifyClosedLoopMeasurement,
  findProductSearchQualityMetrics,
} from "../lib/product-search-closed-loop";

const baselineLogs = [
  { query: "D-Max 2012", resultCount: 0, source: "storefront", createdAt: new Date("2026-05-25T01:00:00.000Z") },
  { query: "d max 2012", resultCount: 2, source: "admin", createdAt: new Date("2026-05-25T02:00:00.000Z") },
];

const baseline = findProductSearchQualityMetrics(baselineLogs, "d-max 2012");
assert.deepEqual(baseline?.sourceCounts, { storefront: 1, admin: 1 });
assert.equal(baseline?.count, 2);
assert.equal(baseline?.avgResultCount, 1);

assert.equal(classifyClosedLoopMeasurement({ baseline, after: null }), "improved");
assert.equal(
  classifyClosedLoopMeasurement({
    baseline,
    after: { count: 2, avgResultCount: 1, latestAt: new Date(), sourceCounts: {} },
  }),
  "unchanged",
);
assert.equal(
  classifyClosedLoopMeasurement({
    baseline,
    after: { count: 3, avgResultCount: 0.5, latestAt: new Date(), sourceCounts: {} },
  }),
  "regressed",
);
assert.equal(classifyClosedLoopMeasurement({ baseline: null, after: baseline }), "unmeasured");

console.log("product search closed-loop tests passed");
