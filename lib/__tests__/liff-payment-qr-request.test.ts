import assert from "node:assert/strict";
import test from "node:test";

import { parseLiffPaymentQrRequest } from "@/lib/liff-payment-qr-request";

test("accepts the explicit all-outstanding mode", () => {
  assert.deepEqual(parseLiffPaymentQrRequest({ mode: "total" }), { mode: "total" });
});

test("normalizes and deduplicates selected bill ids", () => {
  assert.deepEqual(
    parseLiffPaymentQrRequest({ mode: "selected", saleIds: [" sale-a ", "sale-b", "sale-a"] }),
    { mode: "selected", saleIds: ["sale-a", "sale-b"] },
  );
});

test("rejects empty, malformed, and oversized selections", () => {
  assert.equal(parseLiffPaymentQrRequest({ mode: "selected", saleIds: [] }), null);
  assert.equal(parseLiffPaymentQrRequest({ mode: "selected", saleIds: [null, 123] }), null);
  assert.equal(
    parseLiffPaymentQrRequest({
      mode: "selected",
      saleIds: Array.from({ length: 51 }, (_, index) => `sale-${index}`),
    }),
    null,
  );
});
