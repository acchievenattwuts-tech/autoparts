import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MarketplaceReturnStockDisposition } from "@/lib/generated/prisma";
import {
  calculateMarketplaceOrderOutstanding,
  isMarketplaceReturnQuantityAvailable,
  returnDispositionReversesStockCost,
} from "@/lib/marketplace/returns";

describe("marketplace returns", () => {
  it("closes a fully returned order and keeps only the partial outstanding balance", () => {
    assert.equal(calculateMarketplaceOrderOutstanding(2_250, 2_250), 0);
    assert.equal(calculateMarketplaceOrderOutstanding(2_250, 750), 1_500);
  });

  it("reverses stock cost only when the goods are restocked", () => {
    assert.equal(returnDispositionReversesStockCost(MarketplaceReturnStockDisposition.RESTOCK), true);
    assert.equal(returnDispositionReversesStockCost(MarketplaceReturnStockDisposition.REFUND_ONLY), false);
    assert.equal(
      returnDispositionReversesStockCost(
        MarketplaceReturnStockDisposition.DAMAGED_NO_RESTOCK,
      ),
      false,
    );
  });

  it("blocks cumulative over-return while tolerating decimal rounding noise", () => {
    assert.equal(isMarketplaceReturnQuantityAvailable(10, 4, 6), true);
    assert.equal(isMarketplaceReturnQuantityAvailable(10, 4, 6.00009), true);
    assert.equal(isMarketplaceReturnQuantityAvailable(10, 4, 6.01), false);
  });
});
