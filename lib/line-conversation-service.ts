import { LineConversationAiStatus } from "@/lib/generated/prisma";
import type { LineConversationStateAction, LineConversationStatePatch } from "@/lib/line-conversation-types";

export function buildLineConversationStatePatch(action: LineConversationStateAction): LineConversationStatePatch {
  switch (action.type) {
    case "customer_message":
      return {
        lastCustomerMessageAt: action.at,
      };
    case "admin_message":
      return {
        aiStatus: LineConversationAiStatus.PAUSED_BY_ADMIN,
        assignedAdminId: action.adminUserId,
        lastAdminMessageAt: action.at,
        pausedAt: action.at,
        pausedReason: action.pauseReason ?? "ADMIN_REPLY",
      };
    case "pause":
      return {
        aiStatus: LineConversationAiStatus.PAUSED_BY_ADMIN,
        assignedAdminId: action.adminUserId ?? undefined,
        pausedAt: action.at,
        pausedReason: action.reason ?? "PAUSED_BY_ADMIN",
      };
    case "resume":
      return {
        aiStatus: LineConversationAiStatus.ACTIVE,
        resumedAt: action.at,
        pausedReason: null,
      };
    case "waiting_admin":
      return {
        aiStatus: LineConversationAiStatus.WAITING_ADMIN,
        assignedAdminId: action.adminUserId ?? undefined,
        pausedAt: action.at,
        pausedReason: action.reason ?? "WAITING_ADMIN",
      };
    case "close":
      return {
        aiStatus: LineConversationAiStatus.CLOSED,
        closedAt: action.at,
      };
  }
}
