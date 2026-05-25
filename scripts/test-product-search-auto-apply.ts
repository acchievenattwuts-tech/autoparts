import assert from "node:assert/strict";

import {
  buildAutoApplySearchSynonymPlan,
  parseProductSearchAutoApplyEnabledSetting,
} from "../lib/product-search-auto-apply";

const fixedDate = new Date("2026-05-25T00:00:00.000Z");

const baseCluster = {
  normalizedQuery: "คอมแอร์",
  rawQueries: ["คอมแอ", "คอมแอร์"],
  count: 4,
  latestAt: fixedDate,
  minResultCount: 0,
  avgResultCount: 0,
  sourceCounts: { storefront: 4 },
  bucket: "no-result" as const,
  candidateAction: "search-synonym" as const,
};

const eligible = buildAutoApplySearchSynonymPlan({
  clusters: [baseCluster],
  existingSynonyms: [],
  outcomeByKey: new Map(),
});
assert.equal(eligible.length, 1);
assert.equal(eligible[0].eligible, true);
assert.equal(eligible[0].term, "คอมแอร์");
assert.deepEqual(eligible[0].synonymsToAdd, ["คอมแอ"]);
assert.equal(eligible[0].dryRunOnly, true);

const rejectedNonSynonym = buildAutoApplySearchSynonymPlan({
  clusters: [{ ...baseCluster, normalizedQuery: "denso 447280", candidateAction: "product-alias-oem" }],
  existingSynonyms: [],
  outcomeByKey: new Map(),
});
assert.equal(rejectedNonSynonym[0].eligible, false);
assert.equal(rejectedNonSynonym[0].reason, "UNSUPPORTED_CANDIDATE_ACTION");

const rejectedNumericSynonym = buildAutoApplySearchSynonymPlan({
  clusters: [{ ...baseCluster, normalizedQuery: "civic 2012", rawQueries: ["civic 2012"] }],
  existingSynonyms: [],
  outcomeByKey: new Map(),
});
assert.equal(rejectedNumericSynonym[0].eligible, false);
assert.equal(rejectedNumericSynonym[0].reason, "NUMERIC_OR_CODE_LIKE_QUERY");

const rejectedReviewed = buildAutoApplySearchSynonymPlan({
  clusters: [baseCluster],
  existingSynonyms: [],
  outcomeByKey: new Map([["คอมแอร์\u0000search-synonym", { status: "IGNORED" }]]),
});
assert.equal(rejectedReviewed[0].eligible, false);
assert.equal(rejectedReviewed[0].reason, "ALREADY_REVIEWED");

const existing = buildAutoApplySearchSynonymPlan({
  clusters: [baseCluster],
  existingSynonyms: [{ id: "syn-1", term: "คอมแอร์", synonyms: ["คอมแอ"], language: "th", isActive: true }],
  outcomeByKey: new Map(),
});
assert.equal(existing[0].eligible, false);
assert.equal(existing[0].reason, "DUPLICATE_SYNONYM");

const maxed = buildAutoApplySearchSynonymPlan({
  clusters: [{ ...baseCluster, rawQueries: ["คอมแอร์รถยน"] }],
  existingSynonyms: [{
    id: "syn-2",
    term: "คอมแอร์",
    synonyms: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
    language: "th",
    isActive: true,
  }],
  outcomeByKey: new Map(),
});
assert.equal(maxed[0].eligible, false);
assert.equal(maxed[0].reason, "MAX_SYNONYMS_REACHED");

assert.equal(parseProductSearchAutoApplyEnabledSetting("true"), true);
assert.equal(parseProductSearchAutoApplyEnabledSetting("false"), false);
assert.equal(parseProductSearchAutoApplyEnabledSetting(undefined), false);
assert.equal(parseProductSearchAutoApplyEnabledSetting("unexpected"), false);

console.log("product-search-auto-apply tests passed");
