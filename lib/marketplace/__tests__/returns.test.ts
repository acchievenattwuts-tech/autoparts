import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateMarketplaceOrderOutstanding,
  isFullyReversedMarketplaceProduct,
} from "@/lib/marketplace/returns";

describe("marketplace returns", () => {
  it("closes a fully returned order and keeps only the partial outstanding balance", () => {
    assert.equal(calculateMarketplaceOrderOutstanding(2_250, 2_250), 0);
    assert.equal(calculateMarketplaceOrderOutstanding(2_250, 750), 1_500);
  });

  it("hides only product aggregates that are fully reversed to zero", () => {
    assert.equal(
      isFullyReversedMarketplaceProduct({ quantity: 0, salesAmount: 0, grossProfit: 0 }),
      true,
    );
    assert.equal(
      isFullyReversedMarketplaceProduct({ quantity: 0, salesAmount: 0, grossProfit: -1_383.24 }),
      false,
    );
    assert.equal(
      isFullyReversedMarketplaceProduct({ quantity: 0.5, salesAmount: 750, grossProfit: 250 }),
      false,
    );
  });

});
