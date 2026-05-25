import assert from "node:assert/strict";

import {
  mergeSearchSynonymCandidate,
  PRODUCT_SEARCH_CANDIDATE_MAX_SYNONYMS,
} from "../lib/product-search-candidate-apply";

const added = mergeSearchSynonymCandidate(["radiator"], "หม้อน้ำ", "หมอน้ำ");
assert.equal(added.success, true);
assert.deepEqual(added.success ? added.synonyms : [], ["radiator", "หมอน้ำ"]);

const duplicate = mergeSearchSynonymCandidate(["หมอน้ำ"], "หม้อน้ำ", " หมอน้ำ ");
assert.equal(duplicate.success, true);
assert.deepEqual(duplicate.success ? duplicate.synonyms : [], ["หมอน้ำ"]);
assert.equal(duplicate.success ? duplicate.changed : true, false);

const sameAsTerm = mergeSearchSynonymCandidate(["radiator"], "หม้อน้ำ", "หม้อน้ำ");
assert.equal(sameAsTerm.success, true);
assert.deepEqual(sameAsTerm.success ? sameAsTerm.synonyms : [], ["radiator"]);

const full = mergeSearchSynonymCandidate(
  Array.from({ length: PRODUCT_SEARCH_CANDIDATE_MAX_SYNONYMS }, (_, index) => `synonym-${index}`),
  "term",
  "new synonym",
);
assert.equal(full.success, false);
assert.equal(full.success ? "" : full.error, "MAX_SYNONYMS_REACHED");

console.log("product search candidate apply tests passed");
