import test from "node:test";
import assert from "node:assert/strict";

import { getBrandVariants, resolveBrandVariants } from "@/lib/line-brand-variants";

test("maps an English brand to its Thai spellings (and back)", () => {
  const toyota = getBrandVariants("Toyota");
  assert.ok(toyota.includes("toyota"));
  assert.ok(toyota.includes("โตโยต้า"));
  // Thai input resolves to the same variant set
  assert.deepEqual(getBrandVariants("โตโยต้า").sort(), toyota.sort());
});

test("covers the active CarBrand master rows", () => {
  for (const [eng, thai] of [
    ["Nissan", "นิสสัน"],
    ["Honda", "ฮอนด้า"],
    ["Isuzu", "อีซูซุ"],
    ["Mazda", "มาสด้า"],
    ["Mitsubishi", "มิตซูบิชิ"],
  ] as const) {
    assert.ok(getBrandVariants(eng).includes(thai.toLowerCase()), `${eng} should include ${thai}`);
  }
});

test("passes through an unknown brand as a single lowercased token", () => {
  assert.deepEqual(getBrandVariants("Tesla"), ["tesla"]);
});

test("is safe on empty input", () => {
  assert.deepEqual(getBrandVariants(null), []);
  assert.deepEqual(getBrandVariants(""), []);
  assert.deepEqual(getBrandVariants(undefined), []);
});

test("resolveBrandVariants prefers the DB lookup and unions the fallback", () => {
  const dbLookup = new Map<string, string[]>([
    ["toyota", ["toyota", "โตโยต้า", "รถยนต์โตโยต้า"]],
    ["รถยนต์โตโยต้า", ["toyota", "โตโยต้า", "รถยนต์โตโยต้า"]],
  ]);
  const out = resolveBrandVariants("Toyota", dbLookup);
  assert.ok(out.includes("รถยนต์โตโยต้า"), "includes the DB-only spelling");
  assert.ok(out.includes("โตโยต้า"), "still includes the hardcoded fallback");
});

test("resolveBrandVariants falls back to the hardcoded map when no DB lookup / miss", () => {
  assert.deepEqual(resolveBrandVariants("Toyota", null).sort(), getBrandVariants("Toyota").sort());
  // DB lookup provided but brand not present → fallback
  assert.deepEqual(
    resolveBrandVariants("Toyota", new Map()).sort(),
    getBrandVariants("Toyota").sort(),
  );
});
