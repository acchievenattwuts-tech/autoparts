import assert from "node:assert/strict";
import test from "node:test";

import {
  applyLazadaPriceUplift,
  deriveLazadaPriceFromWholesale,
  deriveMarketplacePricesFromWholesale,
  deriveRetailPriceFromWholesale,
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
  assert.equal(deriveLazadaPriceFromWholesale(290), 510);
});

test("Lazada price adds 5% on top of the fee formula and retail follows it", () => {
  assert.equal(deriveLazadaPriceFromWholesale(100), 235);
  assert.equal(deriveLazadaPriceFromWholesale(1_000), 1_545);
  assert.equal(deriveRetailPriceFromWholesale(1_000), deriveLazadaPriceFromWholesale(1_000));
  assert.equal(deriveLazadaPriceFromWholesale(0), 0);
});

test("Lazada uplift raises a stored price by 5% with the always-advance rounding", () => {
  assert.equal(applyLazadaPriceUplift(1_470), 1_545);
  assert.equal(applyLazadaPriceUplift(1_500), 1_580);
  assert.equal(applyLazadaPriceUplift(0), 0);
  assert.equal(applyLazadaPriceUplift(Number.NaN), 0);
});
