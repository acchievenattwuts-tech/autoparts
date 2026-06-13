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
import { Prisma } from "@/lib/generated/prisma";

type JsonInput = Prisma.InputJsonValue;

/** Thrown by `appendLineMessage` when the inbound row loses the race to a
 *  concurrent insert with the same `lineEventId` (LINE re-delivery). Callers
 *  treat it as "this event was already processed" and skip the rest of the
 *  pipeline. */
export class DuplicateLineEventError extends Error {
  readonly lineEventId: string;
  constructor(lineEventId: string) {
    super(`Duplicate LINE event ${lineEventId}`);
    this.name = "DuplicateLineEventError";
    this.lineEventId = lineEventId;
  }
}

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
  try {
    return await db.lineMessage.create({
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
  } catch (error) {
    // Race fallback: webhook + LINE re-delivery can both pass the upfront
    // `hasProcessedLineEvent` check before either commits. The unique index on
    // `lineEventId` then rejects the second insert — translate it so callers
    // can skip the duplicate cleanly.
    if (
      input.lineEventId &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new DuplicateLineEventError(input.lineEventId);
    }
    throw error;
  }
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

/**
 * Counts payment slips on this conversation that still need admin attention
 * (not yet confirmed or rejected). Used to enrich the "customer waiting for admin"
 * notification title with a slip-status hint.
 */
export async function countPendingPaymentSlipsForConversation(conversationId: string): Promise<number> {
  return db.paymentSlip.count({
    where: {
      conversationId,
      verificationStatus: {
        in: ["PENDING_REVIEW", "MATCHED_PENDING_ADMIN_CONFIRM", "NEEDS_MORE_INFO"],
      },
    },
  });
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

// ── Coalescing engine primitives ────────────────────────────────────────────
// These power the "debounce + abort-on-newer" turn aggregation (Option A): one
// background worker owns a conversation's burst at a time (lock), every inbound
// bumps a monotonic seq so the owner can detect "a newer message arrived during
// processing", and the owner re-runs until a clean pass (no new seq) before it
// finally replies with the latest reply token.

/**
 * Atomically claims the per-conversation processing lock. Succeeds only when the
 * lock is free or its lease has expired (so a crashed owner's lock self-heals).
 * Returns true when THIS worker became the owner.
 */
export async function acquireLineConversationLock(input: {
  conversationId: string;
  owner: string;
  leaseMs: number;
}): Promise<boolean> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + input.leaseMs);
  const result = await db.lineConversation.updateMany({
    where: {
      id: input.conversationId,
      OR: [{ processingOwner: null }, { processingLeaseUntil: { lt: now } }],
    },
    data: { processingOwner: input.owner, processingLeaseUntil: leaseUntil },
  });
  return result.count === 1;
}

/** Extends the lease while the owner is still working (long abort-on-newer loops).
 *  Returns false if the lock was stolen (lease expired + reclaimed) meanwhile. */
export async function renewLineConversationLock(input: {
  conversationId: string;
  owner: string;
  leaseMs: number;
}): Promise<boolean> {
  const leaseUntil = new Date(Date.now() + input.leaseMs);
  const result = await db.lineConversation.updateMany({
    where: { id: input.conversationId, processingOwner: input.owner },
    data: { processingLeaseUntil: leaseUntil },
  });
  return result.count === 1;
}

/** Releases the lock (no-op if this worker is no longer the owner). */
export async function releaseLineConversationLock(input: {
  conversationId: string;
  owner: string;
}): Promise<void> {
  await db.lineConversation.updateMany({
    where: { id: input.conversationId, processingOwner: input.owner },
    data: { processingOwner: null, processingLeaseUntil: null },
  });
}

/** Bumps the inbound seq for each new customer message and stamps the customer
 *  activity time. The returned value is the seq assigned to this message. */
export async function bumpLineInboundSeq(conversationId: string): Promise<number> {
  const updated = await db.lineConversation.update({
    where: { id: conversationId },
    data: { lastInboundSeq: { increment: 1 }, lastCustomerMessageAt: new Date() },
    select: { lastInboundSeq: true },
  });
  return updated.lastInboundSeq;
}

/** Snapshot of the coalescing counters + AI status used by the owner loop. */
export async function getLineCoalesceState(conversationId: string): Promise<{
  lastInboundSeq: number;
  lastProcessedSeq: number;
  aiStatus: LineConversationAiStatus;
} | null> {
  return db.lineConversation.findUnique({
    where: { id: conversationId },
    select: { lastInboundSeq: true, lastProcessedSeq: true, aiStatus: true },
  });
}

/** Marks the seq up to which the AI has now replied (so the next burst only
 *  gathers genuinely newer messages). */
export async function markLineProcessedSeq(input: {
  conversationId: string;
  seq: number;
}): Promise<void> {
  await db.lineConversation.update({
    where: { id: input.conversationId },
    data: { lastProcessedSeq: input.seq },
  });
}

/** All inbound customer messages that arrived after the most recent outbound
 *  (AI or admin) reply — i.e. the unanswered turn to be coalesced and processed
 *  together (oldest → newest). */
export async function getUnansweredInboundLineMessages(conversationId: string) {
  const lastOutbound = await db.lineMessage.findFirst({
    where: {
      conversationId,
      direction: { in: [LineMessageDirection.OUTBOUND_AI, LineMessageDirection.OUTBOUND_ADMIN] },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return db.lineMessage.findMany({
    where: {
      conversationId,
      direction: LineMessageDirection.INBOUND,
      ...(lastOutbound ? { createdAt: { gt: lastOutbound.createdAt } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      text: true,
      messageType: true,
      replyToken: true,
      lineEventId: true,
      lineMessageId: true,
      intent: true,
      createdAt: true,
    },
  });
}
