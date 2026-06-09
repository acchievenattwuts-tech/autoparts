import test from "node:test";
import assert from "node:assert/strict";

import { extractFitmentTerms } from "@/lib/line-fitment-extract";

test("extracts car keyword + year", () => {
  assert.deepEqual(extractFitmentTerms("มีคอมแอร์ vios 2017 ไหม"), ["vios", "2017"]);
});

test("extracts Thai car keyword", () => {
  assert.deepEqual(extractFitmentTerms("วีออส ปี 2015"), ["วีออส", "2015"]);
});

test("returns empty when no fitment terms", () => {
  assert.deepEqual(extractFitmentTerms("เอาตัวนี้เลยค่ะ"), []);
  assert.deepEqual(extractFitmentTerms(null), []);
});

test("dedupes repeated terms", () => {
  assert.deepEqual(extractFitmentTerms("civic civic 2020 2020"), ["civic", "2020"]);
});

test("matches spaced model name 'd max'", () => {
  assert.deepEqual(extractFitmentTerms("คอยเย็น d max"), ["d max"]);
});

test("expands plausible two-digit Thai shorthand year 'ปี 06' to 2006", () => {
  assert.deepEqual(extractFitmentTerms("ปี 06"), ["2006"]);
  assert.deepEqual(extractFitmentTerms("คอยเย็น d max ปี 06"), ["d max", "2006"]);
});

test("ignores ambiguous high two-digit year (e.g. 'ปี 60') in the deterministic fallback", () => {
  // 60 > SHORT_YEAR_MAX (could be พ.ศ. 2560); left to the AI consolidation step.
  assert.deepEqual(extractFitmentTerms("ปี 60"), []);
});
