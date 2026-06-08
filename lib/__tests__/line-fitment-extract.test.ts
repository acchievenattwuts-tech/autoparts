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
