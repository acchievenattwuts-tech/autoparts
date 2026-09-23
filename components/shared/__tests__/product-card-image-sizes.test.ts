import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT_CARD_IMAGE_SIZES } from "../ProductCard";

// Every grid that renders ProductCard is two columns on phones, so the phone
// slot must not be declared as the full viewport (it doubled image bytes).
test("ProductCard declares a half-viewport photo slot on phones", () => {
  assert.match(PRODUCT_CARD_IMAGE_SIZES, /^\(max-width: 640px\) 50vw,/);
  assert.doesNotMatch(PRODUCT_CARD_IMAGE_SIZES, /100vw/);
});
