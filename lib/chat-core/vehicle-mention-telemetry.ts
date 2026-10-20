import { db } from "@/lib/db";

/**
 * Messenger audit rows for the vehicle-mention conflict check and the customer's
 * "ใช่" to the confirmation question. Messenger has no channel-specific AI audit
 * table, so — like logMessengerModelGroundingShadow — the row goes to
 * LineAiAuditLog with a null LINE FK and the Messenger conversation id in the
 * payload. LINE writes the same action names through its own audit path.
 */
export type MessengerVehicleMentionAuditAction =
  | "VEHICLE_MENTION_CONFLICT"
  | "VEHICLE_CONFIRMATION_ACCEPTED"
  | "VEHICLE_CONFIRMATION_REJECTED";

export async function logMessengerVehicleMentionEvent(input: {
  messengerConversationId: string;
  action: MessengerVehicleMentionAuditAction;
  payload: Record<string, string | number | null>;
}): Promise<void> {
  try {
    await db.lineAiAuditLog.create({
      data: {
        conversationId: null,
        action: input.action,
        payload: {
          channel: "messenger",
          messengerConversationId: input.messengerConversationId,
          ...input.payload,
        },
      },
    });
  } catch {
    // Observability must never break or delay a customer reply.
  }
}
