import test from "node:test";
import assert from "node:assert/strict";

import {
  extractProductSearchRequiredTokens,
  isDirectProductCodeToken,
} from "@/lib/product-search-required-tokens";

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

test("does not treat car-generation markers as required tokens", () => {
  assert.deepEqual(extractProductSearchRequiredTokens("คอยล์เย็น Vios gen3 2013"), []);
  assert.deepEqual(extractProductSearchRequiredTokens("คอมแอร์ Vios Gen3"), []);
  assert.deepEqual(extractProductSearchRequiredTokens("ท่อแอร์ CR-V เจน4"), []);
  assert.deepEqual(extractProductSearchRequiredTokens("หม้อน้ำ Accord Gen8"), []);
  // A generation marker must not shadow a real part-code anchor in the same query.
  assert.deepEqual(extractProductSearchRequiredTokens("คอมแอร์ Vios Gen3 STA-7065"), ["sta-7065"]);
});

test("keeps real part-code anchors required", () => {
  assert.deepEqual(extractProductSearchRequiredTokens("วาล์วแอร์ R134a"), ["r134a"]);
  assert.deepEqual(extractProductSearchRequiredTokens("คอมแอร์ STA-7065"), ["sta-7065"]);
  assert.deepEqual(extractProductSearchRequiredTokens("คอม dragon 709"), ["709"]);
});
test("direct-code fast-path rejects numeric-only anchors but keeps real codes", () => {
  assert.equal(isDirectProductCodeToken("2500"), false);
  assert.equal(isDirectProductCodeToken("709"), false);
  assert.equal(isDirectProductCodeToken("p0368"), true);
  assert.equal(isDirectProductCodeToken("sta-7065"), true);
  assert.equal(isDirectProductCodeToken("r134a"), true);
});
