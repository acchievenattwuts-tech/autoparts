import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateMarketplaceOrderOutstanding } from "@/lib/marketplace/returns";

describe("marketplace returns", () => {
  it("closes a fully returned order and keeps only the partial outstanding balance", () => {
    assert.equal(calculateMarketplaceOrderOutstanding(2_250, 2_250), 0);
    assert.equal(calculateMarketplaceOrderOutstanding(2_250, 750), 1_500);
  });

});
