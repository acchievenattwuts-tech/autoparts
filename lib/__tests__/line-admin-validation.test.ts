import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

test("parses a valid admin LINE reply payload", async () => {
  const { parseLineAdminReplyBody } = await import("@/lib/line-admin-validation");

  const result = parseLineAdminReplyBody({ text: "  สวัสดีครับ  " });

  assert.deepEqual(result, { text: "สวัสดีครับ" });
});

test("rejects an empty admin LINE reply payload", async () => {
  const { parseLineAdminReplyBody } = await import("@/lib/line-admin-validation");

  assert.throws(
    () => parseLineAdminReplyBody({ text: "   " }),
    /EMPTY_MESSAGE/,
  );
});

test("parses a valid LINE conversation reason payload", async () => {
  const { parseLineConversationReasonBody } = await import("@/lib/line-admin-validation");

  const result = parseLineConversationReasonBody({ reason: "  WAITING_ADMIN_FROM_UI  " });

  assert.deepEqual(result, { reason: "WAITING_ADMIN_FROM_UI" });
});

test("parses and validates a payment-slip review decision", async () => {
  const { parsePaymentSlipReviewBody } = await import("@/lib/line-admin-validation");

  assert.deepEqual(parsePaymentSlipReviewBody({ decision: "confirm" }), { decision: "confirm" });
  assert.throws(() => parsePaymentSlipReviewBody({ decision: "bad" }), /INVALID_DECISION/);
});
