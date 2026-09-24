import assert from "node:assert/strict";
import test from "node:test";
import { mergeImportedSynonyms } from "@/lib/search-synonym-import-merge";
import { MAX_SYNONYMS_PER_TERM } from "@/lib/search-synonyms";

const fill = (count: number, prefix = "existing") => Array.from({ length: count }, (_, i) => `${prefix}-${i + 1}`);

test("keeps existing synonyms first and verbatim, then appends new ones", () => {
  const merge = mergeImportedSynonyms({
    existing: ["วาล์วน้ำ", " Thermostat "],
    incoming: ["thermo stat", "วาวน้ำ"],
    term: "เทอร์โมสตัท",
  });
  assert.deepEqual(merge.synonyms, ["วาล์วน้ำ", " Thermostat ", "thermo stat", "วาวน้ำ"]);
  assert.deepEqual(merge.added, ["thermo stat", "วาวน้ำ"]);
  assert.deepEqual(merge.skippedOverCap, []);
});

test("never drops an existing synonym when the row is already over the cap", () => {
  const existing = fill(MAX_SYNONYMS_PER_TERM + 2);
  const merge = mergeImportedSynonyms({ existing, incoming: ["brand-new"], term: "term" });
  assert.deepEqual(merge.synonyms, existing);
  assert.deepEqual(merge.added, []);
  assert.deepEqual(merge.skippedOverCap, ["brand-new"]);
});

test("fills up to MAX_SYNONYMS_PER_TERM and reports the rest instead of truncating", () => {
  const existing = fill(MAX_SYNONYMS_PER_TERM - 1);
  const merge = mergeImportedSynonyms({ existing, incoming: ["new-a", "new-b", "new-c"], term: "term" });
  assert.equal(merge.synonyms.length, MAX_SYNONYMS_PER_TERM);
  assert.deepEqual(merge.synonyms.slice(0, existing.length), existing);
  assert.deepEqual(merge.added, ["new-a"]);
  assert.deepEqual(merge.skippedOverCap, ["new-b", "new-c"]);
});

test("the cap is the shared MAX_SYNONYMS_PER_TERM, not the old hard-coded 10", () => {
  const merge = mergeImportedSynonyms({ existing: [], incoming: fill(15, "n"), term: "term" });
  assert.equal(MAX_SYNONYMS_PER_TERM >= 15, true);
  assert.equal(merge.synonyms.length, 15);
  assert.deepEqual(merge.skippedOverCap, []);
});

test("skips blanks, the term itself, case/whitespace duplicates and excluded keys", () => {
  const merge = mergeImportedSynonyms({
    existing: ["Compressor"],
    incoming: ["", "   ", "คอมแอร์", "COMPRESSOR", "ac  compressor", "AC Compressor", "owned-elsewhere"],
    term: "คอมแอร์",
    excludeKeys: new Set(["owned-elsewhere"]),
  });
  assert.deepEqual(merge.added, ["ac  compressor"]);
  assert.deepEqual(merge.synonyms, ["Compressor", "ac  compressor"]);
});

test("an explicit cap overrides the default", () => {
  const merge = mergeImportedSynonyms({ existing: ["a"], incoming: ["b", "c"], term: "t", cap: 2 });
  assert.deepEqual(merge.synonyms, ["a", "b"]);
  assert.deepEqual(merge.skippedOverCap, ["c"]);
});
