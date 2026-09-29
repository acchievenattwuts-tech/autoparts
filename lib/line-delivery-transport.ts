import { z } from "zod";
import type { Prisma } from "@/lib/generated/prisma";

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const LINE_PUSH_TIMEOUT_MS = 12_000;
const messageSchema = z.object({
  type: z.literal("flex"), altText: z.string().min(1).max(400),
  contents: z.record(z.string(), z.unknown()),
});

export class DeliveryLinePushError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean) {
    super(code);
    this.name = "DeliveryLinePushError";
  }
}

// One HTTP attempt only. The durable dispatch owns retry timing and the key.
export const pushDeliveryLineCard = async (input: {
  accessToken: string; recipientId: string; retryKey: string; payload: Prisma.JsonValue;
}): Promise<{ requestId: string | null }> => {
  try {
    const parsed = messageSchema.safeParse(input.payload);
    if (!parsed.success) throw new DeliveryLinePushError("INVALID_PAYLOAD", false);
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
    throw new DeliveryLinePushError(`LINE_HTTP_${response.status}`, response.status === 429 || response.status >= 500);
  } catch (error) {
    if (error instanceof DeliveryLinePushError) throw error;
    throw new DeliveryLinePushError("LINE_NETWORK_ERROR", true);
  }
};
