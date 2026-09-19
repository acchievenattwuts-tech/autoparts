import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveLazadaPriceFromWholesale,
  deriveMarketplacePricesFromWholesale,
  deriveShopeePriceFromWholesale,
} from "../product-pricing";

test("Shopee price adds 40% and rounds up to the next 5/0 ending", () => {
  assert.equal(deriveShopeePriceFromWholesale(290), 410);
  assert.equal(deriveShopeePriceFromWholesale(100), 145);
  assert.equal(deriveShopeePriceFromWholesale(10_500), 14_705);
});

test("Shopee price preserves the existing always-advance rounding rule", () => {
  assert.equal(deriveShopeePriceFromWholesale(200), 285);
  assert.equal(deriveShopeePriceFromWholesale(10_500), 14_705);
});

test("Shopee price returns zero when wholesale cannot produce a price", () => {
  assert.equal(deriveShopeePriceFromWholesale(0), 0);
  assert.equal(deriveShopeePriceFromWholesale(-1), 0);
  assert.equal(deriveShopeePriceFromWholesale(Number.NaN), 0);
  assert.equal(deriveShopeePriceFromWholesale(Number.POSITIVE_INFINITY), 0);
});

test("combined marketplace pricing uses the new Shopee formula without changing Lazada", () => {
  assert.deepEqual(deriveMarketplacePricesFromWholesale(290), {
    shopeePrice: 410,
    lazadaPrice: deriveLazadaPriceFromWholesale(290),
  });
  assert.equal(deriveLazadaPriceFromWholesale(290), 485);
});
