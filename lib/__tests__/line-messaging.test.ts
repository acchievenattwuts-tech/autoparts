import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { verifyLineWebhookSignature } from "@/lib/line-webhook-signature";

test("valid LINE webhook signature is accepted", () => {
  const channelSecret = "test-secret";
  const body = JSON.stringify({ events: [{ type: "message" }] });
  const signature = createHmac("sha256", channelSecret).update(body).digest("base64");

  assert.equal(
    verifyLineWebhookSignature({
      channelSecret,
      body,
      signature,
    }),
    true,
  );
});

test("invalid LINE webhook signature is rejected", () => {
  assert.equal(
    verifyLineWebhookSignature({
      channelSecret: "test-secret",
      body: JSON.stringify({ events: [] }),
      signature: "invalid-signature",
    }),
    false,
  );
});

test("missing LINE webhook signature is rejected", () => {
  assert.equal(
    verifyLineWebhookSignature({
      channelSecret: "test-secret",
      body: JSON.stringify({ events: [] }),
      signature: null,
    }),
    false,
  );
});
