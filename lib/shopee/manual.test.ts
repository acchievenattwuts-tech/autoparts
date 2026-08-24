import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateShopeeSettlement } from "./manual";

describe("manual Shopee settlement", () => {
  it("reconciles multiple fee types against the actual payout", () => {
    assert.deepEqual(calculateShopeeSettlement(1_000, [70, 32.5, 10], 887.5), {
      salesAmount: 1_000,
      feeAmount: 112.5,
      expectedPayout: 887.5,
      difference: 0,
    });
  });

  it("exposes a rounded difference and never hides a mismatch", () => {
    assert.equal(calculateShopeeSettlement(999.99, [50.12], 950).difference, 0.13);
  });
});
