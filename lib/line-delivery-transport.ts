import { z } from "zod";
import type { Prisma } from "@/lib/generated/prisma";

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const LINE_PUSH_TIMEOUT_MS = 12_000;
const messageSchema = z.object({
  type: z.literal("flex"), altText: z.string().min(1).max(400),
  contents: z.record(z.string(), z.unknown()),
});

export class DeliveryLinePushError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "DeliveryLinePushError";
  }
}

/**
 * Loggable code for any dispatch-path error. Never the message: database and
 * LINE errors can carry customer data such as LINE user ids.
 */
export const getDeliveryErrorLogCode = (error: unknown): string => {
  if (error instanceof DeliveryLinePushError) return error.code;
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code;
  return error instanceof Error ? error.name : "UNKNOWN_ERROR";
};

// One HTTP attempt only, and a failed card is never sent again (owner decision
// T6). The retry key header stays: LINE then rejects an accidental duplicate push.
export const pushDeliveryLineCard = async (input: {
  accessToken: string; recipientId: string; retryKey: string; payload: Prisma.JsonValue;
}): Promise<{ requestId: string | null }> => {
  try {
    const parsed = messageSchema.safeParse(input.payload);
    if (!parsed.success) throw new DeliveryLinePushError("INVALID_PAYLOAD");
    const response = await fetch(LINE_PUSH_URL, {
      method: "POST", signal: AbortSignal.timeout(LINE_PUSH_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json",
        "X-Line-Retry-Key": input.retryKey,
      },
      body: JSON.stringify({ to: input.recipientId, messages: [parsed.data] }),
    });
    const acceptedRequestId = response.headers.get("x-line-accepted-request-id");
    if (response.ok || (response.status === 409 && acceptedRequestId)) {
      return { requestId: acceptedRequestId ?? response.headers.get("x-line-request-id") };
    }
    // Never store raw LINE responses: they can contain customer identifiers.
    throw new DeliveryLinePushError(`LINE_HTTP_${response.status}`);
  } catch (error) {
    if (error instanceof DeliveryLinePushError) throw error;
    // Network failures and the request timeout share one code.
    throw new DeliveryLinePushError("LINE_NETWORK_ERROR");
  }
};
