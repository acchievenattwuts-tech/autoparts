import assert from "node:assert/strict";
import test from "node:test";
import { isPriceListCompatibleWithChannel } from "../price-lists";
import {
  resolveLegacyChatPrice,
  resolveChatNormalPrice,
  resolveLegacySalePrice,
  resolveNormalPrice,
  type LegacyProductPrices,
} from "../resolve-price";

const complete: LegacyProductPrices = {
  salePrice: 100,
  memberPrice: 120,
  retailPrice: 150,
};

test("legacy STORE selection remains byte-for-byte equivalent for all tiers", () => {
  assert.equal(resolveLegacySalePrice(complete, "WHOLESALE"), 100);
  assert.equal(resolveLegacySalePrice(complete, "MEMBER"), 120);
  assert.equal(resolveLegacySalePrice(complete, "RETAIL"), 150);
});

test("legacy RETAIL alone falls back to wholesale when retail is zero", () => {
  const prices = { ...complete, retailPrice: 0 };
  assert.equal(resolveLegacySalePrice(prices, "RETAIL"), 100);
  assert.equal(resolveLegacySalePrice(prices, "MEMBER"), 120);
});

test("legacy MEMBER zero remains zero and never falls back", () => {
  assert.equal(resolveLegacySalePrice({ ...complete, memberPrice: 0 }, "MEMBER"), 0);
});

test("legacy chat RETAIL zero remains hidden and never uses the sale-form fallback", () => {
  assert.equal(resolveLegacyChatPrice({ ...complete, retailPrice: 0 }, "RETAIL"), 0);
});

test("chat Price List resolution uses configured marketplace price and hides a missing one", () => {
  assert.equal(
    resolveChatNormalPrice({
      priceListCode: "SHOPEE",
      configuredAmount: 225,
      legacyPrices: complete,
    }).amount,
    225,
  );
  assert.deepEqual(resolveChatNormalPrice({ priceListCode: "LAZADA", legacyPrices: complete }), {
    amount: 0,
    source: "MISSING",
    isMissing: true,
    usedRetailFallback: false,
  });
});

test("configured price wins and explicit zero remains a configured value", () => {
  assert.deepEqual(
    resolveNormalPrice({ priceListCode: "SHOPEE", configuredAmount: 0, legacyPrices: complete }),
    { amount: 0, source: "PRICE_LIST", isMissing: false, usedRetailFallback: false },
  );
});

test("missing marketplace price never falls back to a legacy price", () => {
  assert.deepEqual(resolveNormalPrice({ priceListCode: "LAZADA", legacyPrices: complete }), {
    amount: 0,
    source: "MISSING",
    isMissing: true,
    usedRetailFallback: false,
  });
});

test("missing legacy ProductPrice rows use compatibility columns during rollout", () => {
  assert.deepEqual(resolveNormalPrice({ priceListCode: "MEMBER", legacyPrices: complete }), {
    amount: 120,
    source: "LEGACY_COMPATIBILITY",
    isMissing: false,
    usedRetailFallback: false,
  });
});

test("configured RETAIL zero preserves the existing STORE fallback", () => {
  assert.deepEqual(
    resolveNormalPrice({ priceListCode: "RETAIL", configuredAmount: 0, legacyPrices: complete }),
    { amount: 100, source: "PRICE_LIST", isMissing: false, usedRetailFallback: true },
  );
});

test("channel-bound Price Lists only match their own marketplace", () => {
  assert.equal(isPriceListCompatibleWithChannel("SHOPEE", "SHOPEE"), true);
  assert.equal(isPriceListCompatibleWithChannel("SHOPEE", "LAZADA"), false);
  assert.equal(isPriceListCompatibleWithChannel(null, "STORE"), true);
  assert.equal(isPriceListCompatibleWithChannel(null, "SHOPEE"), false);
});
