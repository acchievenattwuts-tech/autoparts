"use server";

import { revalidatePath } from "next/cache";

import { LineConversationAiStatus } from "@/lib/generated/prisma";
import {
  closeMessengerConversation,
  markMessengerConversationWaitingAdmin,
  pauseMessengerConversation,
  resumeMessengerConversation,
  sendMessengerAdminMessage,
} from "@/lib/messenger-admin-service";
import { requirePermission } from "@/lib/require-auth";

export type MessengerActionResult =
  | { ok: true }
  | { ok: false; error: string };

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return "คุณไม่มีสิทธิ์ดำเนินการนี้";
  if (message === "CONVERSATION_NOT_FOUND" || message === "NOT_FOUND") return "ไม่พบบทสนทนานี้";
  if (message === "EMPTY_MESSAGE") return "กรุณาพิมพ์ข้อความก่อนส่ง";
  if (message.includes("NOT_CONFIGURED")) return "ยังไม่ได้ตั้งค่า Messenger Page Access Token";
  return "ดำเนินการไม่สำเร็จ กรุณาลองใหม่";
}

/** Change a Messenger conversation's AI status (pause / resume / waiting / close). */
export async function changeMessengerConversationStatusAction(input: {
  conversationId: string;
  status: LineConversationAiStatus;
}): Promise<MessengerActionResult> {
  try {
    const session = await requirePermission("messenger_conversations.manage");
    const base = {
      conversationId: input.conversationId,
      adminUserId: session.user.id,
      adminUserName: session.user.name ?? null,
      adminUserRole: session.user.role ?? null,
    };
    switch (input.status) {
      case LineConversationAiStatus.ACTIVE:
        await resumeMessengerConversation(base);
        break;
      case LineConversationAiStatus.PAUSED_BY_ADMIN:
        await pauseMessengerConversation(base);
        break;
      case LineConversationAiStatus.WAITING_ADMIN:
        await markMessengerConversationWaitingAdmin(base);
        break;
      case LineConversationAiStatus.CLOSED:
        await closeMessengerConversation(base);
        break;
    }
    revalidatePath("/admin/messenger-conversations");
    revalidatePath(`/admin/messenger-conversations/${input.conversationId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}

/** Send a manual admin text reply to a Messenger conversation. */
export async function sendMessengerAdminMessageAction(input: {
  conversationId: string;
  text: string;
}): Promise<MessengerActionResult> {
  try {
    const session = await requirePermission("messenger_conversations.reply");
    await sendMessengerAdminMessage({
      conversationId: input.conversationId,
      adminUserId: session.user.id,
      adminUserName: session.user.name ?? null,
      adminUserRole: session.user.role ?? null,
      text: input.text,
    });
    revalidatePath(`/admin/messenger-conversations/${input.conversationId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}
