import assert from "node:assert/strict";
import test from "node:test";
import {
  isPromotionBelowCost,
  promotionRangesOverlapInclusive,
  resolveScheduledPrice,
  shouldWarnPromotionDiscountStacking,
} from "../price-promotion";

const normalPrice = {
  amount: 500,
  source: "PRICE_LIST" as const,
  isMissing: false,
  usedRetailFallback: false,
};
const promotion = {
  id: "promo-1",
  status: "PUBLISHED" as const,
  startDateKey: "2026-09-01",
  endDateKey: "2026-09-07",
  promotionPrice: 399,
};

test("scheduled promotion boundaries are inclusive and use the bill sale date", () => {
  assert.equal(resolveScheduledPrice({ saleDateKey: "2026-09-01", normalPrice, promotions: [promotion] }).amount, 399);
  assert.equal(resolveScheduledPrice({ saleDateKey: "2026-09-07", normalPrice, promotions: [promotion] }).amount, 399);
  assert.equal(resolveScheduledPrice({ saleDateKey: "2026-09-08", normalPrice, promotions: [promotion] }).amount, 500);
});

test("draft and cancelled promotions never override price", () => {
  assert.equal(resolveScheduledPrice({
    saleDateKey: "2026-09-03",
    normalPrice,
    promotions: [{ ...promotion, status: "DRAFT" }],
  }).source, "NORMAL_PRICE");
});

test("zero is a valid promotion price", () => {
  assert.equal(resolveScheduledPrice({
    saleDateKey: "2026-09-03",
    normalPrice,
    promotions: [{ ...promotion, promotionPrice: 0 }],
  }).amount, 0);
});

test("promotion cannot resolve when the normal Price List value is missing", () => {
  assert.throws(
    () => resolveScheduledPrice({
      saleDateKey: "2026-09-03",
      normalPrice: { ...normalPrice, amount: 0, isMissing: true, source: "MISSING" },
      promotions: [promotion],
    }),
    /PROMOTION_NORMAL_PRICE_MISSING/,
  );
});

test("overlapping published candidates fail closed", () => {
  assert.throws(
    () => resolveScheduledPrice({
      saleDateKey: "2026-09-03",
      normalPrice,
      promotions: [promotion, { ...promotion, id: "promo-2" }],
    }),
    /OVERLAPPING_PUBLISHED_PRICE_PROMOTIONS/,
  );
  assert.equal(
    promotionRangesOverlapInclusive(promotion, {
      startDateKey: "2026-09-07",
      endDateKey: "2026-09-10",
    }),
    true,
  );
});

test("below-cost and discount-stacking warnings are deterministic", () => {
  assert.equal(isPromotionBelowCost(99, 100), true);
  assert.equal(isPromotionBelowCost(100, 100), false);
  assert.equal(shouldWarnPromotionDiscountStacking({ promotionApplied: true, lineDiscount: 0, billDiscount: 1 }), true);
  assert.equal(shouldWarnPromotionDiscountStacking({ promotionApplied: false, lineDiscount: 10, billDiscount: 10 }), false);
});
