import { z } from "zod";

const lineAdminReplyBodySchema = z.object({
  text: z.string().trim().min(1, "EMPTY_MESSAGE").max(2000, "MESSAGE_TOO_LONG"),
});

const lineConversationReasonBodySchema = z.object({
  reason: z.string().trim().max(500, "REASON_TOO_LONG").optional().nullable(),
});

const paymentSlipReviewBodySchema = z.object({
  decision: z.enum(["confirm", "reject", "needs_info"], {
    error: "INVALID_DECISION",
  }),
});

function parseWithError<T>(schema: z.ZodType<T>, body: unknown, fallbackError: string): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;

  const issueMessage = result.error.issues[0]?.message;
  throw new Error(issueMessage || fallbackError);
}

export function parseLineAdminReplyBody(body: unknown) {
  return parseWithError(lineAdminReplyBodySchema, body, "INVALID_REPLY_PAYLOAD");
}

export function parseLineConversationReasonBody(body: unknown) {
  const parsed = parseWithError(lineConversationReasonBodySchema, body, "INVALID_REASON_PAYLOAD");
  return {
    reason: parsed.reason?.trim() || null,
  };
}

export function parsePaymentSlipReviewBody(body: unknown) {
  return parseWithError(paymentSlipReviewBodySchema, body, "INVALID_DECISION");
}
