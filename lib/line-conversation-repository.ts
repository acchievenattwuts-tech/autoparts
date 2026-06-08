import { db } from "@/lib/db";
import {
  LineAiJobStatus,
  LineAiSuggestionStatus,
  LineConversationAiStatus,
  LineDeliveryStatus,
  LineMessageDirection,
} from "@/lib/generated/prisma";
import type {
  LineAiConfidence,
  LineAiJobType,
  LineConversationStatePatch,
  LineDeliveryMode,
  LineIntent,
  LineMessageType,
  PaymentSlipVerificationStatus,
} from "@/lib/line-conversation-types";
import type { Prisma } from "@/lib/generated/prisma";

type JsonInput = Prisma.InputJsonValue;

export async function hasProcessedLineEvent(lineEventId: string | null | undefined) {
  if (!lineEventId) return false;

  const existing = await db.lineMessage.findUnique({
    where: { lineEventId },
    select: { id: true },
  });

  return Boolean(existing);
}

export async function findActiveCustomerIdByLineUserId(lineUserId: string) {
  const customer = await db.customer.findUnique({
    where: { lineUserId },
    select: { id: true, isActive: true },
  });

  return customer?.isActive ? customer.id : null;
}

export async function getOrCreateLineConversation(input: {
  lineUserId: string;
  displayName?: string | null;
  pictureUrl?: string | null;
  customerId?: string | null;
}) {
  const now = new Date();

  return db.lineConversation.upsert({
    where: { lineUserId: input.lineUserId },
    update: {
      displayName: input.displayName ?? undefined,
      pictureUrl: input.pictureUrl ?? undefined,
      customerId: input.customerId ?? undefined,
    },
    create: {
      lineUserId: input.lineUserId,
      displayName: input.displayName ?? null,
      pictureUrl: input.pictureUrl ?? null,
      customerId: input.customerId ?? null,
      aiStatus: LineConversationAiStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    },
  });
}

/**
 * Manually links (or unlinks with null) a conversation to a customer. This only
 * sets `LineConversation.customerId` — it never touches `Customer.lineUserId`
 * (which belongs to the LIFF/Login channel and must stay intact). Use this when
 * the OA Messaging-API userId differs from the LIFF userId (cross-provider).
 */
export async function setLineConversationCustomer(input: {
  conversationId: string;
  customerId: string | null;
}) {
  return db.lineConversation.update({
    where: { id: input.conversationId },
    data: { customerId: input.customerId },
    select: { id: true, customerId: true },
  });
}

/** Lightweight customer search (active only) for the manual-link picker. */
export async function searchCustomersForConversationLink(input: { query: string; take?: number }) {
  const query = input.query.trim();
  if (!query) return [];

  return db.customer.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { code: { contains: query, mode: "insensitive" } },
        { phone: { contains: query } },
      ],
    },
    select: { id: true, code: true, name: true, phone: true },
    orderBy: { name: "asc" },
    take: Math.min(20, Math.max(1, input.take ?? 10)),
  });
}

export async function updateLineConversationState(conversationId: string, patch: LineConversationStatePatch) {
  return db.lineConversation.update({
    where: { id: conversationId },
    data: patch,
  });
}

export async function appendLineMessage(input: {
  conversationId: string;
  lineUserId: string;
  lineMessageId?: string | null;
  lineEventId?: string | null;
  replyToken?: string | null;
  direction: LineMessageDirection;
  messageType: LineMessageType;
  intent?: LineIntent | null;
  text?: string | null;
  imageUrl?: string | null;
  rawEvent?: JsonInput | null;
  deliveryMode?: LineDeliveryMode | null;
  deliveryStatus?: LineDeliveryStatus | null;
  adminUserId?: string | null;
  sentAt?: Date | null;
}) {
  return db.lineMessage.create({
    data: {
      conversationId: input.conversationId,
      lineUserId: input.lineUserId,
      lineMessageId: input.lineMessageId ?? null,
      lineEventId: input.lineEventId ?? null,
      replyToken: input.replyToken ?? null,
      direction: input.direction,
      messageType: input.messageType,
      intent: input.intent ?? null,
      text: input.text ?? null,
      imageUrl: input.imageUrl ?? null,
      rawEvent: input.rawEvent ?? undefined,
      deliveryMode: input.deliveryMode ?? null,
      deliveryStatus: input.deliveryStatus ?? null,
      adminUserId: input.adminUserId ?? null,
      sentAt: input.sentAt ?? null,
    },
  });
}

/**
 * Recent messages for a conversation (chronological, oldest → newest) used to
 * give the AI short-term memory of the ongoing chat. Lightweight select only.
 */
export async function getRecentLineMessagesForAi(conversationId: string, take = 10) {
  const rows = await db.lineMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(take, 1), 30),
    select: { id: true, direction: true, text: true, messageType: true },
  });
  return rows.reverse();
}

/**
 * Counts how many of the most-recent product searches in this conversation came
 * back empty, consecutively (newest first, stopping at the first non-empty / non-
 * search). Reads the PRODUCT_SEARCH_SUMMARY audit trail. Used to escalate to an
 * admin after repeated no-result searches.
 */
export async function countConsecutiveFailedLineSearches(conversationId: string): Promise<number> {
  const rows = await db.lineAiAuditLog.findMany({
    where: { conversationId, action: "PRODUCT_SEARCH_SUMMARY" },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { payload: true },
  });

  let count = 0;
  for (const row of rows) {
    const payload = row.payload as { searched?: boolean; total?: number } | null;
    if (payload && payload.searched === true && (payload.total ?? 0) === 0) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

export async function storeLineAiJob(input: {
  conversationId: string;
  lineMessageId?: string | null;
  jobType: LineAiJobType;
  status?: LineAiJobStatus;
  payload?: JsonInput | null;
  result?: JsonInput | null;
  error?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}) {
  return db.lineAiJob.create({
    data: {
      conversationId: input.conversationId,
      lineMessageId: input.lineMessageId ?? null,
      jobType: input.jobType,
      status: input.status ?? LineAiJobStatus.PENDING,
      payload: input.payload ?? undefined,
      result: input.result ?? undefined,
      error: input.error ?? null,
      startedAt: input.startedAt ?? null,
      finishedAt: input.finishedAt ?? null,
    },
  });
}

export async function updateLineAiJob(
  jobId: string,
  patch: {
    status?: LineAiJobStatus;
    result?: JsonInput | null;
    error?: string | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
  },
) {
  return db.lineAiJob.update({
    where: { id: jobId },
    data: {
      status: patch.status,
      result: patch.result ?? undefined,
      error: patch.error,
      startedAt: patch.startedAt,
      finishedAt: patch.finishedAt,
    },
  });
}

export async function storeLineAiSuggestion(input: {
  conversationId: string;
  lineMessageId?: string | null;
  intent?: LineIntent | null;
  suggestedReply: string;
  confidence: LineAiConfidence;
  matchedProducts?: JsonInput | null;
  reasoningSummary?: string | null;
  status?: LineAiSuggestionStatus;
  deliveryMode?: LineDeliveryMode | null;
  sentAt?: Date | null;
}) {
  return db.lineAiSuggestion.create({
    data: {
      conversationId: input.conversationId,
      lineMessageId: input.lineMessageId ?? null,
      intent: input.intent ?? null,
      suggestedReply: input.suggestedReply,
      confidence: input.confidence,
      matchedProducts: input.matchedProducts ?? undefined,
      reasoningSummary: input.reasoningSummary ?? null,
      status: input.status ?? LineAiSuggestionStatus.DRAFT,
      deliveryMode: input.deliveryMode ?? null,
      sentAt: input.sentAt ?? null,
    },
  });
}

export async function storeLineAiAudit(input: {
  conversationId?: string | null;
  action: string;
  payload?: JsonInput | null;
}) {
  return db.lineAiAuditLog.create({
    data: {
      conversationId: input.conversationId ?? null,
      action: input.action,
      payload: input.payload ?? undefined,
    },
  });
}

export async function storePaymentSlip(input: {
  conversationId: string;
  lineUserId: string;
  lineMessageId?: string | null;
  imageUrl?: string | null;
  detectedAmount?: Prisma.Decimal | number | string | null;
  detectedTransferDatetime?: Date | null;
  detectedBank?: string | null;
  detectedSenderName?: string | null;
  detectedReceiverName?: string | null;
  detectedReferenceNo?: string | null;
  matchedSaleId?: string | null;
  verificationStatus?: PaymentSlipVerificationStatus;
  rawOcr?: JsonInput | null;
}) {
  return db.paymentSlip.create({
    data: {
      conversationId: input.conversationId,
      lineUserId: input.lineUserId,
      lineMessageId: input.lineMessageId ?? null,
      imageUrl: input.imageUrl ?? null,
      detectedAmount: input.detectedAmount ?? null,
      detectedTransferDatetime: input.detectedTransferDatetime ?? null,
      detectedBank: input.detectedBank ?? null,
      detectedSenderName: input.detectedSenderName ?? null,
      detectedReceiverName: input.detectedReceiverName ?? null,
      detectedReferenceNo: input.detectedReferenceNo ?? null,
      matchedSaleId: input.matchedSaleId ?? null,
      verificationStatus: input.verificationStatus,
      rawOcr: input.rawOcr ?? undefined,
    },
  });
}

export async function markOutboundLineMessageSent(input: {
  messageId: string;
  deliveryMode: LineDeliveryMode;
  sentAt?: Date;
}) {
  return db.lineMessage.update({
    where: { id: input.messageId },
    data: {
      deliveryMode: input.deliveryMode,
      deliveryStatus: LineDeliveryStatus.SENT,
      sentAt: input.sentAt ?? new Date(),
    },
  });
}
