import test from "node:test";
import assert from "node:assert/strict";

import { extractShopeeEscrowFeeLines } from "../escrow-utils";

test("extracts commission service and seller voucher fees from escrow_detail", () => {
  const lines = extractShopeeEscrowFeeLines({
    order_sn: "250101ABC",
    escrow_detail: {
      commission_fee: -12.5,
      service_fee: "3.25",
      voucher_from_seller: 10,
      buyer_total_amount: 250,
    },
  });

  assert.deepEqual(lines.map((line) => [line.kind, line.amount, line.sourceKey]), [
    ["COMMISSION", 12.5, "commission_fee"],
    ["SERVICE", 3.25, "service_fee"],
    ["VOUCHER", 10, "voucher_from_seller"],
  ]);
});

test("returns empty when snapshot has no supported escrow fee keys", () => {
  assert.deepEqual(extractShopeeEscrowFeeLines({ order_sn: "x", total_amount: 100 }), []);
});

test("finds nested escrow objects without treating totals as fees", () => {
  const lines = extractShopeeEscrowFeeLines({
    response: {
      escrow_detail: {
        buyer_total_amount: 100,
        seller_transaction_fee: 8,
        serviceFee: 5,
      },
    },
  });

  assert.deepEqual(lines.map((line) => [line.kind, line.amount]), [["SERVICE", 5]]);
});
