import { db } from "@/lib/db";
import {
  AuditAction,
  LineConversationAiStatus,
  LineDeliveryMode,
  LineDeliveryStatus,
  LineMessageDirection,
  LineMessageType,
} from "@/lib/generated/prisma";
import { buildLineConversationStatePatch } from "@/lib/line-conversation-service";
import { safeWriteAuditLog } from "@/lib/audit-log";
import {
  appendMessengerMessage,
  getRecentMessengerMessagesForAi,
} from "@/lib/messenger/messenger-conversation-repository";
import { getMessengerConfig } from "@/lib/messenger/messenger-config";
import { sendMessengerText } from "@/lib/messenger/messenger-messaging";

/**
 * Admin-facing service for the Messenger inbox. Mirrors lib/line-admin-service
 * against the Messenger* tables. Every state mutation writes a central AuditLog
 * entry (Messenger has no dedicated audit table by design).
 */

const DEFAULT_TAKE = 30;
const MAX_TAKE = 100;

function normalizeTake(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_TAKE;
  return Math.min(MAX_TAKE, Math.max(1, Math.trunc(value)));
}

const PENDING_SLIP_STATUSES = [
  "PENDING_REVIEW",
  "MATCHED_PENDING_ADMIN_CONFIRM",
  "NEEDS_MORE_INFO",
] as const;

export async function listMessengerConversations(input: {
  status?: LineConversationAiStatus | null;
  take?: number | null;
}) {
  return db.messengerConversation.findMany({
    where: input.status ? { aiStatus: input.status } : undefined,
    select: {
      id: true,
      psid: true,
      displayName: true,
      aiStatus: true,
      assignedAdminId: true,
      lastCustomerMessageAt: true,
      lastAdminMessageAt: true,
      pausedReason: true,
      updatedAt: true,
      customer: { select: { id: true, name: true, phone: true } },
      assignedAdmin: { select: { id: true, name: true } },
      _count: { select: { messages: true } },
      paymentSlips: {
        where: { verificationStatus: { in: [...PENDING_SLIP_STATUSES] } },
        select: { id: true, verificationStatus: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
    orderBy: [{ lastCustomerMessageAt: "desc" }, { updatedAt: "desc" }],
    take: normalizeTake(input.take),
  });
}

export async function getMessengerConversationMessages(input: {
  conversationId: string;
  take?: number | null;
}) {
  const conversation = await db.messengerConversation.findUnique({
    where: { id: input.conversationId },
    select: {
      id: true,
      psid: true,
      displayName: true,
      aiStatus: true,
      pausedReason: true,
      customer: { select: { id: true, name: true, phone: true } },
      assignedAdmin: { select: { id: true, name: true } },
    },
  });
  if (!conversation) return null;

  const latestMessages = await db.messengerMessage.findMany({
    where: { conversationId: input.conversationId },
    select: {
      id: true,
      mid: true,
      direction: true,
      messageType: true,
      intent: true,
      text: true,
      imageUrl: true,
      deliveryMode: true,
      deliveryStatus: true,
      adminUser: { select: { id: true, name: true } },
      aiSuggestions: {
        select: {
          id: true,
          suggestedReply: true,
          confidence: true,
          reasoningSummary: true,
          status: true,
          deliveryMode: true,
          createdAt: true,
          sentAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      sentAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: normalizeTake(input.take),
  });

  return { conversation, messages: latestMessages.reverse() };
}

type StateChangeInput = {
  conversationId: string;
  adminUserId: string;
  adminUserName?: string | null;
  adminUserRole?: string | null;
  reason?: string | null;
};

async function applyState(
  input: StateChangeInput,
  patch: ReturnType<typeof buildLineConversationStatePatch>,
  action: string,
) {
  const conversation = await db.messengerConversation.update({
    where: { id: input.conversationId },
    data: patch,
    select: { id: true, aiStatus: true },
  });

  await safeWriteAuditLog({
    userId: input.adminUserId,
    userName: input.adminUserName ?? null,
    userRole: input.adminUserRole ?? null,
    action: AuditAction.UPDATE,
    entityType: "MessengerConversation",
    entityId: input.conversationId,
    entityRef: action,
    after: { aiStatus: conversation.aiStatus, reason: input.reason ?? null },
  });

  return conversation;
}

export function pauseMessengerConversation(input: StateChangeInput) {
  return applyState(
    input,
    buildLineConversationStatePatch({
      type: "pause",
      adminUserId: input.adminUserId,
      at: new Date(),
      reason: input.reason ?? "PAUSED_BY_ADMIN",
    }),
    "MESSENGER_ADMIN_PAUSE",
  );
}

export function resumeMessengerConversation(input: StateChangeInput) {
  return applyState(
    input,
    buildLineConversationStatePatch({ type: "resume", at: new Date() }),
    "MESSENGER_ADMIN_RESUME",
  );
}

export function markMessengerConversationWaitingAdmin(input: StateChangeInput) {
  return applyState(
    input,
    buildLineConversationStatePatch({
      type: "waiting_admin",
      adminUserId: input.adminUserId,
      at: new Date(),
      reason: input.reason ?? "WAITING_ADMIN",
    }),
    "MESSENGER_ADMIN_MARK_WAITING",
  );
}

export function closeMessengerConversation(input: StateChangeInput) {
  return applyState(
    input,
    buildLineConversationStatePatch({ type: "close", at: new Date() }),
    "MESSENGER_ADMIN_CLOSE",
  );
}

/**
 * Sends a manual admin text reply via the Send API, persists it, and pauses the
 * AI (admin has taken over). Uses MESSAGE_TAG so it works even outside the 24h
 * window for a human-agent follow-up. Image replies are not yet supported.
 */
export async function sendMessengerAdminMessage(input: {
  conversationId: string;
  adminUserId: string;
  adminUserName?: string | null;
  adminUserRole?: string | null;
  text?: string | null;
}) {
  const text = input.text?.trim() ?? "";
  if (!text) throw new Error("EMPTY_MESSAGE");

  const conversation = await db.messengerConversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, psid: true },
  });
  if (!conversation) throw new Error("CONVERSATION_NOT_FOUND");

  const config = getMessengerConfig();
  if (!config.pageAccessToken) throw new Error("MESSENGER_PAGE_ACCESS_TOKEN_NOT_CONFIGURED");

  const row = await appendMessengerMessage({
    conversationId: conversation.id,
    psid: conversation.psid,
    direction: LineMessageDirection.OUTBOUND_ADMIN,
    messageType: LineMessageType.TEXT,
    text,
    deliveryMode: LineDeliveryMode.PUSH,
    deliveryStatus: LineDeliveryStatus.PENDING,
    adminUserId: input.adminUserId,
  });

  // human_agent tag lets a real admin reply outside the 24h standard window.
  await sendMessengerText({
    pageAccessToken: config.pageAccessToken,
    psid: conversation.psid,
    text,
    messagingType: "MESSAGE_TAG",
    tag: "HUMAN_AGENT",
  });

  await db.messengerMessage.update({
    where: { id: row.id },
    data: { deliveryStatus: LineDeliveryStatus.SENT, sentAt: new Date() },
  });

  // Admin reply pauses the AI on this conversation.
  await db.messengerConversation.update({
    where: { id: conversation.id },
    data: buildLineConversationStatePatch({
      type: "admin_message",
      adminUserId: input.adminUserId,
      at: new Date(),
    }),
  });

  await safeWriteAuditLog({
    userId: input.adminUserId,
    userName: input.adminUserName ?? null,
    userRole: input.adminUserRole ?? null,
    action: AuditAction.UPDATE,
    entityType: "MessengerConversation",
    entityId: conversation.id,
    entityRef: "MESSENGER_ADMIN_SEND_MESSAGE",
    meta: { messageId: row.id, hasText: true },
  });

  return { ok: true, messageId: row.id };
}

export { getRecentMessengerMessagesForAi };
