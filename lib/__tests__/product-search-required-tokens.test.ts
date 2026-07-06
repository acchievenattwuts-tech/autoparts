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
  assert.deepEqual(extractProductSearchRequiredTokens("คอยเย็น Avanza 12-15"), []);
  assert.deepEqual(extractProductSearchRequiredTokens("คอยเย็น Avanza 2012-2015"), []);
  assert.deepEqual(extractProductSearchRequiredTokens("คอยเย็น Avanza 12-15 STB-2116"), ["stb-2116"]);
});

test("does not treat car shorthand years as part-code anchors", () => {
  assert.deepEqual(extractProductSearchRequiredTokens("คอยเย็น Jazz 08-12"), []);
  assert.deepEqual(extractProductSearchRequiredTokens("คอยเย็น City 03"), []);
  assert.deepEqual(extractProductSearchRequiredTokens("กรองแอร์ Vios 13-19"), []);
});

test("keeps real part-code anchors required", () => {
  assert.deepEqual(extractProductSearchRequiredTokens("วาล์วแอร์ R134a"), ["r134a"]);
  assert.deepEqual(extractProductSearchRequiredTokens("คอมแอร์ STA-7065"), ["sta-7065"]);
  assert.deepEqual(extractProductSearchRequiredTokens("คอม dragon 709"), ["709"]);
});
