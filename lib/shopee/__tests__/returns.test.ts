import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyShopeeReturnReviewSignal,
  getShopeeReviewPolicy,
} from "@/lib/shopee/returns-utils";

describe("Shopee returns utils", () => {
  it("classifies cancelled order statuses for manual review", () => {
    const signal = classifyShopeeReturnReviewSignal("CANCELLED", {});

    assert.equal(signal.kind, "CANCELLATION");
    assert.equal(getShopeeReviewPolicy(signal.kind), "MANUAL_REVIEW_ONLY");
  });

  it("classifies nested return/refund hints from snapshots", () => {
    const returnSignal = classifyShopeeReturnReviewSignal("COMPLETED", {
      reverse_order: { return_sn: "RT123" },
    });
    const refundSignal = classifyShopeeReturnReviewSignal("COMPLETED", {
      payment: { refund_amount: 120 },
    });

    assert.equal(returnSignal.kind, "RETURN");
    assert.equal(refundSignal.kind, "REFUND");
  });

  it("leaves normal ready orders untouched", () => {
    const signal = classifyShopeeReturnReviewSignal("READY_TO_SHIP", {
      order_sn: "250101ABC",
    });

    assert.equal(signal.kind, "NONE");
    assert.equal(getShopeeReviewPolicy(signal.kind), "NO_ACTION");
  });
});

