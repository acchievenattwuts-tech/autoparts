import test from "node:test";
import assert from "node:assert/strict";

import { extractProductSearchRequiredTokens } from "@/lib/product-search-required-tokens";

test("extracts numeric model and part fragments as required search tokens", () => {
  assert.deepEqual(extractProductSearchRequiredTokens("คอม dragon 709"), ["709"]);
  assert.deepEqual(extractProductSearchRequiredTokens("STA-7065 447220-1234"), [
    "sta-7065",
    "447220-1234",
  ]);
});

test("does not treat plausible car years as required tokens", () => {
  assert.deepEqual(extractProductSearchRequiredTokens("คอม dmax 2012 2070"), ["2070"]);
});
