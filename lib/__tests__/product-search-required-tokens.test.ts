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

test("does not treat car-year range shorthand as required tokens", () => {
  // Regression: "12-15" (years 2012–2015) must NOT become a hard anchor —
  // no product name contains "12-15", which zeroed the LINE search.
  assert.deepEqual(extractProductSearchRequiredTokens("คอยเย็น Avanza 12-15"), []);
  assert.deepEqual(extractProductSearchRequiredTokens("คอยเย็น Avanza 2012-2015"), []);
  // A real part code with a dash still anchors.
  assert.deepEqual(extractProductSearchRequiredTokens("คอยเย็น Avanza 12-15 STB-2116"), ["stb-2116"]);
});
