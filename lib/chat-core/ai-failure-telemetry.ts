import { db } from "@/lib/db";
import { CHAT_AI_CALL_FAILED_AUDIT_ACTION, type ChatAiCallFailure } from "@/lib/chat-core/ai-call-failure";
import { IMAGE_READ_TIMEOUT_HANDOFF_AUDIT_ACTION } from "@/lib/chat-core/image-read-deadline";

/**
 * Messenger has no AI audit table of its own, so a failed Gemini call is stored
 * in LineAiAuditLog with a null LINE conversation and the Messenger conversation
 * id in the payload — the same convention as the model-grounding shadow events.
 * Best-effort: failures are swallowed and never delay a reply.
 */
export async function logMessengerChatAiFailure(input: {
  messengerConversationId: string;
  failure: ChatAiCallFailure;
}): Promise<void> {
  try {
    await db.lineAiAuditLog.create({
      data: {
        conversationId: null,
        action: CHAT_AI_CALL_FAILED_AUDIT_ACTION,
        payload: {
          channel: "messenger",
          messengerConversationId: input.messengerConversationId,
          ...input.failure,
        },
      },
    });
  } catch {
    // Observability must never break or delay a customer reply.
  }
}

/** Messenger twin of LINE's AI_IMAGE_READ_TIMEOUT_HANDOFF audit row (same table
 *  and convention as above). Best-effort. */
export async function logMessengerImageReadTimeoutHandoff(input: {
  messengerConversationId: string;
  elapsedMs: number;
}): Promise<void> {
  try {
    await db.lineAiAuditLog.create({
      data: {
        conversationId: null,
        action: IMAGE_READ_TIMEOUT_HANDOFF_AUDIT_ACTION,
        payload: {
          channel: "messenger",
          messengerConversationId: input.messengerConversationId,
          elapsedMs: input.elapsedMs,
        },
      },
    });
  } catch {
    // Observability must never break or delay a customer reply.
  }
}
