import { db } from "@/lib/db";
import type { LinePushMessage } from "@/lib/line-daily-summary";
import { getLineDailySummaryConfig, pushLineMessages } from "@/lib/line-messaging";
import { storeLineChatImage } from "@/lib/line-chat-image-storage";
import {
  LineConversationAiStatus,
  LineDeliveryMode,
  LineDeliveryStatus,
  LineMessageDirection,
  LineMessageType,
} from "@/lib/generated/prisma";
import { appendLineMessage, storeLineAiAudit, updateLineConversationState } from "@/lib/line-conversation-repository";
import { buildLineConversationStatePatch } from "@/lib/line-conversation-service";

const DEFAULT_TAKE = 30;
const MAX_TAKE = 100;

function normalizeTake(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_TAKE;
  return Math.min(MAX_TAKE, Math.max(1, Math.trunc(value)));
}

export async function listLineConversations(input: {
  status?: LineConversationAiStatus | null;
  take?: number | null;
}) {
  return db.lineConversation.findMany({
    where: input.status ? { aiStatus: input.status } : undefined,
    select: {
      id: true,
      lineUserId: true,
      displayName: true,
      aiStatus: true,
      assignedAdminId: true,
      lastCustomerMessageAt: true,
      lastAdminMessageAt: true,
      pausedReason: true,
      updatedAt: true,
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
      assignedAdmin: {
        select: {
          id: true,
          name: true,
        },
      },
      _count: {
        select: {
          messages: true,
        },
      },
    },
    orderBy: [
      { lastCustomerMessageAt: "desc" },
      { updatedAt: "desc" },
    ],
    take: normalizeTake(input.take),
  });
}

export async function getLineConversationMessages(input: {
  conversationId: string;
  take?: number | null;
}) {
  const conversation = await db.lineConversation.findUnique({
    where: { id: input.conversationId },
    select: {
      id: true,
      lineUserId: true,
      displayName: true,
      aiStatus: true,
      pausedReason: true,
      customer: { select: { id: true, name: true, phone: true } },
      assignedAdmin: { select: { id: true, name: true } },
    },
  });

  if (!conversation) return null;

  const latestMessages = await db.lineMessage.findMany({
    where: { conversationId: input.conversationId },
    select: {
      id: true,
      direction: true,
      messageType: true,
      intent: true,
      text: true,
      imageUrl: true,
      deliveryMode: true,
      deliveryStatus: true,
      adminUser: { select: { id: true, name: true } },
      sentAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: normalizeTake(input.take),
  });

  const messages = latestMessages.reverse();

  return { conversation, messages };
}

export async function pauseLineConversation(input: {
  conversationId: string;
  adminUserId: string;
  reason?: string | null;
}) {
  const at = new Date();
  const conversation = await updateLineConversationState(
    input.conversationId,
    buildLineConversationStatePatch({
      type: "pause",
      adminUserId: input.adminUserId,
      at,
      reason: input.reason ?? "PAUSED_BY_ADMIN",
    }),
  );

  await storeLineAiAudit({
    conversationId: input.conversationId,
    action: "ADMIN_PAUSE",
    payload: { adminUserId: input.adminUserId, reason: input.reason ?? null },
  });

  return conversation;
}

export async function resumeLineConversation(input: {
  conversationId: string;
  adminUserId: string;
}) {
  const conversation = await updateLineConversationState(
    input.conversationId,
    buildLineConversationStatePatch({ type: "resume", at: new Date() }),
  );

  await storeLineAiAudit({
    conversationId: input.conversationId,
    action: "ADMIN_RESUME",
    payload: { adminUserId: input.adminUserId },
  });

  return conversation;
}

export async function markLineConversationWaitingAdmin(input: {
  conversationId: string;
  adminUserId: string;
  reason?: string | null;
}) {
  const conversation = await updateLineConversationState(
    input.conversationId,
    buildLineConversationStatePatch({
      type: "waiting_admin",
      adminUserId: input.adminUserId,
      at: new Date(),
      reason: input.reason ?? "WAITING_ADMIN",
    }),
  );

  await storeLineAiAudit({
    conversationId: input.conversationId,
    action: "ADMIN_MARK_WAITING",
    payload: { adminUserId: input.adminUserId, reason: input.reason ?? null },
  });

  return conversation;
}

export async function closeLineConversation(input: {
  conversationId: string;
  adminUserId: string;
}) {
  const conversation = await updateLineConversationState(
    input.conversationId,
    buildLineConversationStatePatch({ type: "close", at: new Date() }),
  );

  await storeLineAiAudit({
    conversationId: input.conversationId,
    action: "ADMIN_CLOSE",
    payload: { adminUserId: input.adminUserId },
  });

  return conversation;
}

export async function sendLineAdminMessage(input: {
  conversationId: string;
  adminUserId: string;
  text?: string | null;
  /** Optional image to attach. Re-encoded to a LINE-compatible JPEG before sending. */
  image?: { buffer: Buffer } | null;
}) {
  const text = input.text?.trim() ?? "";
  if (!text && !input.image) {
    throw new Error("EMPTY_MESSAGE");
  }

  const conversation = await db.lineConversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, lineUserId: true },
  });

  if (!conversation) {
    throw new Error("CONVERSATION_NOT_FOUND");
  }

  const config = getLineDailySummaryConfig();
  if (!config.channelAccessToken) {
    throw new Error("LINE_MESSAGING_API_CHANNEL_ACCESS_TOKEN_NOT_CONFIGURED");
  }

  // Build the outbound payload + matching DB rows in send order (image first,
  // then the text caption). Each entry becomes one LINE message and one bubble.
  const lineMessages: LinePushMessage[] = [];
  const appendedMessageIds: string[] = [];

  if (input.image) {
    const stored = await storeLineChatImage({ buffer: input.image.buffer });
    lineMessages.push({
      type: "image",
      originalContentUrl: stored.originalUrl,
      previewImageUrl: stored.previewUrl,
    });
    const imageRow = await appendLineMessage({
      conversationId: conversation.id,
      lineUserId: conversation.lineUserId,
      direction: LineMessageDirection.OUTBOUND_ADMIN,
      messageType: LineMessageType.IMAGE,
      imageUrl: stored.originalUrl,
      deliveryMode: LineDeliveryMode.PUSH,
      deliveryStatus: LineDeliveryStatus.PENDING,
      adminUserId: input.adminUserId,
    });
    appendedMessageIds.push(imageRow.id);
  }

  if (text) {
    lineMessages.push({ type: "text", text });
    const textRow = await appendLineMessage({
      conversationId: conversation.id,
      lineUserId: conversation.lineUserId,
      direction: LineMessageDirection.OUTBOUND_ADMIN,
      messageType: LineMessageType.TEXT,
      text,
      deliveryMode: LineDeliveryMode.PUSH,
      deliveryStatus: LineDeliveryStatus.PENDING,
      adminUserId: input.adminUserId,
    });
    appendedMessageIds.push(textRow.id);
  }

  await pushLineMessages({
    channelAccessToken: config.channelAccessToken,
    recipientIds: [conversation.lineUserId],
    messages: lineMessages,
  });

  await db.lineMessage.updateMany({
    where: { id: { in: appendedMessageIds } },
    data: {
      deliveryStatus: LineDeliveryStatus.SENT,
      sentAt: new Date(),
    },
  });

  await updateLineConversationState(
    conversation.id,
    buildLineConversationStatePatch({
      type: "admin_message",
      adminUserId: input.adminUserId,
      at: new Date(),
    }),
  );

  await storeLineAiAudit({
    conversationId: conversation.id,
    action: "ADMIN_SEND_MESSAGE",
    payload: {
      adminUserId: input.adminUserId,
      deliveryMode: LineDeliveryMode.PUSH,
      messageIds: appendedMessageIds,
      hasImage: Boolean(input.image),
      hasText: Boolean(text),
    },
  });

  return { ok: true, messageId: appendedMessageIds[0], messageIds: appendedMessageIds };
}
