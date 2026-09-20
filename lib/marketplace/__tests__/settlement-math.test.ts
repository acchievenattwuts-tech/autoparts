import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MarketplaceFeeKind } from "@/lib/generated/prisma";
import {
  allocateByShare,
  buildMarketplacePayoutDifferenceLine,
  calculateMarketplaceSettlement,
  normalizeMarketplaceLineAmount,
} from "@/lib/marketplace/settlement-math";

const fee = (amount: number) => ({ kind: MarketplaceFeeKind.FEE, amount });
const adjustment = (amount: number) => ({ kind: MarketplaceFeeKind.ADJUSTMENT, amount });

describe("calculateMarketplaceSettlement", () => {
  it("normalizes fee input to a deduction while preserving adjustment signs", () => {
    assert.equal(normalizeMarketplaceLineAmount(MarketplaceFeeKind.FEE, 120.5), -120.5);
    assert.equal(normalizeMarketplaceLineAmount(MarketplaceFeeKind.FEE, -120.5), -120.5);
    assert.equal(normalizeMarketplaceLineAmount(MarketplaceFeeKind.ADJUSTMENT, 25), 25);
    assert.equal(normalizeMarketplaceLineAmount(MarketplaceFeeKind.ADJUSTMENT, -25), -25);
  });
  it("balances sales minus fees when the payout matches", () => {
    const result = calculateMarketplaceSettlement({
      saleAmounts: [1000, 500],
      returnAmounts: [],
      feeLines: [fee(-120.5), fee(-30.25)],
      payoutAmount: 1349.25,
    });

    assert.equal(result.salesAmount, 1500);
    assert.equal(result.feeAmount, 150.75);
    assert.equal(result.expectedPayout, 1349.25);
    assert.equal(result.difference, 0);
    assert.equal(result.isBalanced, true);
  });

  it("subtracts credit notes so a refunded order never inflates the payout", () => {
    const result = calculateMarketplaceSettlement({
      saleAmounts: [1000],
      returnAmounts: [400],
      feeLines: [fee(-60)],
      payoutAmount: 540,
    });

    assert.equal(result.returnAmount, 400);
    assert.equal(result.expectedPayout, 540);
    assert.equal(result.isBalanced, true);
  });

  it("adds positive adjustments as platform income", () => {
    const result = calculateMarketplaceSettlement({
      saleAmounts: [1000],
      returnAmounts: [],
      feeLines: [fee(-100), adjustment(25)],
      payoutAmount: 925,
    });

    assert.equal(result.feeAmount, 100);
    assert.equal(result.incomeAmount, 25);
    assert.equal(result.expectedPayout, 925);
    assert.equal(result.isBalanced, true);
  });

  it("flags a payout that does not match the calculation", () => {
    const result = calculateMarketplaceSettlement({
      saleAmounts: [1000],
      returnAmounts: [],
      feeLines: [fee(-100)],
      payoutAmount: 880,
    });

    assert.equal(result.difference, -20);
    assert.equal(result.isBalanced, false);
  });

  it("creates a signed automatic adjustment that balances the actual payout", () => {
    const base = calculateMarketplaceSettlement({
      saleAmounts: [1000],
      returnAmounts: [],
      feeLines: [fee(-100)],
      payoutAmount: 880,
    });
    const line = buildMarketplacePayoutDifferenceLine(base.difference);

    assert.deepEqual(line, {
      code: "PAYOUT_DIFFERENCE",
      label: "ส่วนต่างยอดโอนจริง",
      kind: MarketplaceFeeKind.ADJUSTMENT,
      amount: -20,
    });
    const reconciled = calculateMarketplaceSettlement({
      saleAmounts: [1000],
      returnAmounts: [],
      feeLines: [fee(-100), line!],
      payoutAmount: 880,
    });
    assert.equal(reconciled.expectedPayout, 880);
    assert.equal(reconciled.isBalanced, true);
  });

  it("does not create an adjustment inside the rounding tolerance", () => {
    assert.equal(buildMarketplacePayoutDifferenceLine(0.004), null);
  });

  it("treats a half-satang rounding gap as balanced", () => {
    const result = calculateMarketplaceSettlement({
      saleAmounts: [1000],
      returnAmounts: [],
      feeLines: [fee(-100)],
      payoutAmount: 900.001,
    });

    assert.equal(result.isBalanced, true);
  });
});

describe("allocateByShare", () => {
  it("splits proportionally and keeps the total exact", () => {
    const shares = allocateByShare(100, [700, 300]);
    assert.deepEqual(shares, [70, 30]);
    assert.equal(shares.reduce((sum, value) => sum + value, 0), 100);
  });

  it("carries the rounding remainder into the last line", () => {
    const shares = allocateByShare(100, [1, 1, 1]);
    assert.equal(shares.reduce((sum, value) => sum + value, 0), 100);
  });

  it("splits evenly when every weight is zero", () => {
    const shares = allocateByShare(90, [0, 0, 0]);
    assert.equal(shares.reduce((sum, value) => sum + value, 0), 90);
  });
});
