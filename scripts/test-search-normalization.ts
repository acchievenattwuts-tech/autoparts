import assert from "node:assert/strict";
import { buildSearchVariants, normalizeSearchText, tokenizeSearchVariants } from "../lib/search-normalization";

assert.equal(normalizeSearchText("  โตโยต้า   วีออส  "), "โตโยต้า วีออส");
assert.equal(normalizeSearchText(" D-Max "), "d-max");

assert.deepEqual(
  buildSearchVariants("D-Max"),
  ["d-max", "d max", "dmax"],
);

assert.deepEqual(
  buildSearchVariants("Mazda2"),
  ["mazda2", "mazda 2"],
);

assert.deepEqual(
  buildSearchVariants("MU/X"),
  ["mu/x", "mu x", "mux"],
);

assert.deepEqual(
  tokenizeSearchVariants("Hilux Revo"),
  ["hilux revo", "hilux", "revo", "hiluxrevo"],
);

console.log("search normalization tests passed");
