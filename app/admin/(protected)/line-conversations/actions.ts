"use server";

import { revalidatePath } from "next/cache";

import { LineConversationAiStatus } from "@/lib/generated/prisma";
import {
  closeLineConversation,
  markLineConversationWaitingAdmin,
  pauseLineConversation,
  resumeLineConversation,
} from "@/lib/line-admin-service";
import { requirePermission } from "@/lib/require-auth";

export type ChangeStatusResult =
  | { ok: true; status: LineConversationAiStatus }
  | { ok: false; error: string };

/**
 * Updates a LINE conversation's AI status from the list page (no need to open
 * the chat first). Re-verifies the manage permission and routes to the same
 * service functions used by the detail-page buttons — never bypasses business
 * logic (pause / resume / waiting / close all stay consistent across surfaces).
 */
export async function changeLineConversationStatusAction(input: {
  conversationId: string;
  status: LineConversationAiStatus;
}): Promise<ChangeStatusResult> {
  try {
    const session = await requirePermission("line_conversations.manage");

    switch (input.status) {
      case LineConversationAiStatus.ACTIVE:
        await resumeLineConversation({
          conversationId: input.conversationId,
          adminUserId: session.user.id,
        });
        break;
      case LineConversationAiStatus.PAUSED_BY_ADMIN:
        await pauseLineConversation({
          conversationId: input.conversationId,
          adminUserId: session.user.id,
        });
        break;
      case LineConversationAiStatus.WAITING_ADMIN:
        await markLineConversationWaitingAdmin({
          conversationId: input.conversationId,
          adminUserId: session.user.id,
        });
        break;
      case LineConversationAiStatus.CLOSED:
        await closeLineConversation({
          conversationId: input.conversationId,
          adminUserId: session.user.id,
        });
        break;
    }

    revalidatePath("/admin/line-conversations");
    return { ok: true, status: input.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    // Don't leak internals — return a friendly Thai message.
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: "คุณไม่มีสิทธิ์เปลี่ยนสถานะนี้" };
    }
    if (message === "NOT_FOUND") {
      return { ok: false, error: "ไม่พบบทสนทนานี้" };
    }
    return { ok: false, error: "เปลี่ยนสถานะไม่สำเร็จ กรุณาลองใหม่" };
  }
}
