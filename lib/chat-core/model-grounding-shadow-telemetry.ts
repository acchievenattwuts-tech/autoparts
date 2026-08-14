import { db } from "@/lib/db";
import type { ChatModelGroundingShadow } from "@/lib/chat-core/search-guards";

/**
 * Messenger has no channel-specific AI audit table. Store the shared shadow event
 * in LineAiAuditLog with a null LINE FK and the Messenger conversation id inside
 * the payload. This is telemetry only: failures are swallowed and never affect a
 * reply or hard filter.
 */
export async function logMessengerModelGroundingShadow(input: {
  messengerConversationId: string;
  shadow: ChatModelGroundingShadow | null;
  requiredTokens: string[];
  downstreamResolvedModel?: string | null;
}): Promise<void> {
  if (!input.shadow) return;
  try {
    await db.lineAiAuditLog.create({
      data: {
        conversationId: null,
        action: "MODEL_GROUNDING_SHADOW",
        payload: {
          channel: "messenger",
          messengerConversationId: input.messengerConversationId,
          ...input.shadow,
          requiredTokens: input.requiredTokens,
          downstreamResolvedModel: input.downstreamResolvedModel ?? null,
        },
      },
    });
  } catch {
    // Observability must never break or delay a customer reply.
  }
}
