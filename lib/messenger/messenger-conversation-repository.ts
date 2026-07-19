import { db } from "@/lib/db";
import {
  LineAiSuggestionStatus,
  LineConversationAiStatus,
  LineMessageDirection,
  Prisma,
} from "@/lib/generated/prisma";
import type {
  LineAiConfidence,
  LineDeliveryMode,
  LineDeliveryStatus,
  LineIntent,
  LineMessageType,
} from "@/lib/generated/prisma";

/**
 * Persistence layer for the Facebook Messenger channel. Mirrors
 * lib/line-conversation-repository but against the Messenger* tables. The shared
 * AI brain lives in lib/chat-core; this module only stores/loads conversation
 * state so both channels stay behaviourally identical without sharing rows.
 */

type JsonInput = Prisma.InputJsonValue;

/** Thrown when an inbound row loses the race to a concurrent insert with the
 *  same `fbEventId` (Messenger re-delivery). Callers treat it as "already
 *  processed" and skip the rest of the pipeline. */
export class DuplicateMessengerEventError extends Error {
  readonly fbEventId: string;
  constructor(fbEventId: string) {
    super(`Duplicate Messenger event ${fbEventId}`);
    this.name = "DuplicateMessengerEventError";
    this.fbEventId = fbEventId;
  }
}

export async function hasProcessedMessengerEvent(fbEventId: string | null | undefined) {
  if (!fbEventId) return false;
  const existing = await db.messengerMessage.findUnique({
    where: { fbEventId },
    select: { id: true },
  });
  return Boolean(existing);
}

export async function getOrCreateMessengerConversation(input: {
  pageId: string;
  psid: string;
  displayName?: string | null;
  pictureUrl?: string | null;
  customerId?: string | null;
}): Promise<{ conversation: { id: string; aiStatus: LineConversationAiStatus; displayName: string | null }; created: boolean }> {
  const existing = await db.messengerConversation.findUnique({
    where: { pageId_psid: { pageId: input.pageId, psid: input.psid } },
    select: { id: true, aiStatus: true, displayName: true },
  });
  if (existing) {
    // Refresh profile fields best-effort when they change.
    if (input.displayName || input.pictureUrl || input.customerId) {
      await db.messengerConversation.update({
        where: { id: existing.id },
        data: {
          displayName: input.displayName ?? undefined,
          pictureUrl: input.pictureUrl ?? undefined,
          customerId: input.customerId ?? undefined,
        },
      });
    }
    return { conversation: existing, created: false };
  }

  const now = new Date();
  try {
    const conversation = await db.messengerConversation.create({
      data: {
        pageId: input.pageId,
        psid: input.psid,
        displayName: input.displayName ?? null,
        pictureUrl: input.pictureUrl ?? null,
        customerId: input.customerId ?? null,
        aiStatus: LineConversationAiStatus.ACTIVE,
        createdAt: now,
        updatedAt: now,
      },
      select: { id: true, aiStatus: true, displayName: true },
    });
    return { conversation, created: true };
  } catch (error) {
    // Concurrent POSTs raced to create the same (pageId, psid) — re-read the winner.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await db.messengerConversation.findUnique({
        where: { pageId_psid: { pageId: input.pageId, psid: input.psid } },
        select: { id: true, aiStatus: true, displayName: true },
      });
      if (winner) return { conversation: winner, created: false };
    }
    throw error;
  }
}

/** Escalates a conversation to WAITING_ADMIN when the AI hands off (no audit /
 *  admin actor — this is an automated escalation, not an admin action). */
export async function escalateMessengerConversationToAdmin(conversationId: string): Promise<void> {
  await db.messengerConversation.update({
    where: { id: conversationId },
    data: {
      aiStatus: LineConversationAiStatus.WAITING_ADMIN,
      pausedAt: new Date(),
      pausedReason: "AI_HANDOFF",
    },
  });
}

export async function appendMessengerMessage(input: {
  conversationId: string;
  psid: string;
  mid?: string | null;
  fbEventId?: string | null;
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
    return await db.messengerMessage.create({
      data: {
        conversationId: input.conversationId,
        psid: input.psid,
        mid: input.mid ?? null,
        fbEventId: input.fbEventId ?? null,
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
    if (
      input.fbEventId &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new DuplicateMessengerEventError(input.fbEventId);
    }
    throw error;
  }
}

/** Recent messages (chronological, oldest → newest) for short-term AI memory. */
export async function getRecentMessengerMessagesForAi(conversationId: string, take = 10) {
  const rows = await db.messengerMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(take, 1), 30),
    select: { id: true, direction: true, text: true, messageType: true, createdAt: true },
  });
  return rows.reverse();
}

/**
 * ระดับราคาของลูกค้า Messenger รายนี้ (mirror ของ resolveLinePriceTier) — resolve ผ่าน
 * customerId ที่ผูกกับบทสนทนา (Messenger ไม่มีคอลัมน์ Customer.psid — ผูกโดยแอดมิน)
 * WHOLESALE → ประเภทลูกค้า (active) ระดับขายส่ง / MEMBER → ระดับสมาชิก → memberPrice
 * RETAIL → ประเภทลูกค้า (active) ระดับขายปลีก
 * UNLINKED → ยังไม่ผูก / บัญชีปิด / ไม่ระบุประเภท / ประเภทปิด → retailPrice + แนบข้อความราคาพิเศษ
 */
export async function resolveMessengerPriceTier(
  conversationId: string,
): Promise<"UNLINKED" | "RETAIL" | "MEMBER" | "WHOLESALE"> {
  const conversation = await db.messengerConversation.findUnique({
    where: { id: conversationId },
    select: {
      customer: {
        select: { isActive: true, customerType: { select: { priceTier: true, isActive: true } } },
      },
    },
  });
  const customer = conversation?.customer;
  if (!customer?.isActive) return "UNLINKED";
  if (!customer.customerType?.isActive) return "UNLINKED";
  return customer.customerType.priceTier;
}

export async function storeMessengerAiSuggestion(input: {
  conversationId: string;
  messengerMessageId?: string | null;
  intent?: LineIntent | null;
  suggestedReply: string;
  confidence: LineAiConfidence;
  matchedProducts?: JsonInput | null;
  reasoningSummary?: string | null;
  status?: LineAiSuggestionStatus;
  deliveryMode?: LineDeliveryMode | null;
  sentAt?: Date | null;
}) {
  return db.messengerAiSuggestion.create({
    data: {
      conversationId: input.conversationId,
      messengerMessageId: input.messengerMessageId ?? null,
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

// ── Coalescing (debounce + latest-wins + lock) ──────────────────────────────

/** Bumps the inbound seq for a new customer message + stamps activity time.
 *  Returns the seq assigned to this message. */
export async function bumpMessengerInboundSeq(conversationId: string): Promise<number> {
  const updated = await db.messengerConversation.update({
    where: { id: conversationId },
    data: { lastInboundSeq: { increment: 1 }, lastCustomerMessageAt: new Date() },
    select: { lastInboundSeq: true },
  });
  return updated.lastInboundSeq;
}

export async function getMessengerCoalesceState(conversationId: string): Promise<{
  lastInboundSeq: number;
  lastProcessedSeq: number;
  aiStatus: LineConversationAiStatus;
} | null> {
  return db.messengerConversation.findUnique({
    where: { id: conversationId },
    select: { lastInboundSeq: true, lastProcessedSeq: true, aiStatus: true },
  });
}

export async function markMessengerProcessedSeq(input: {
  conversationId: string;
  seq: number;
}): Promise<void> {
  await db.messengerConversation.update({
    where: { id: input.conversationId },
    data: { lastProcessedSeq: input.seq },
  });
}

/** Acquires the short-lived per-conversation processing lock. */
export async function acquireMessengerConversationLock(input: {
  conversationId: string;
  owner: string;
  leaseMs: number;
}): Promise<boolean> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + input.leaseMs);
  const result = await db.messengerConversation.updateMany({
    where: {
      id: input.conversationId,
      OR: [{ processingOwner: null }, { processingLeaseUntil: { lt: now } }],
    },
    data: { processingOwner: input.owner, processingLeaseUntil: leaseUntil },
  });
  return result.count === 1;
}

export async function releaseMessengerConversationLock(input: {
  conversationId: string;
  owner: string;
}): Promise<void> {
  await db.messengerConversation.updateMany({
    where: { id: input.conversationId, processingOwner: input.owner },
    data: { processingOwner: null, processingLeaseUntil: null },
  });
}

/** Coalescing crash failsafe: conversations with customer messages newer than the
 *  last AI reply, no live owner (lock free / lease expired), quiet long enough that
 *  a live owner would already have finished. The cron re-runs the owner loop for
 *  these so a crashed webhook never leaves a customer unanswered. */
export async function findStalledMessengerConversationIds(input: {
  quietBefore: Date;
  take: number;
}): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "MessengerConversation"
    WHERE "lastInboundSeq" > "lastProcessedSeq"
      AND ("processingOwner" IS NULL OR "processingLeaseUntil" < NOW())
      AND "lastCustomerMessageAt" IS NOT NULL
      AND "lastCustomerMessageAt" < ${input.quietBefore}
    ORDER BY "lastCustomerMessageAt" ASC
    LIMIT ${input.take}`;
  return rows.map((row) => row.id);
}

/** psid of a conversation (the owner loop needs it to address the Send API). */
export async function getMessengerConversationPsid(conversationId: string): Promise<string | null> {
  const row = await db.messengerConversation.findUnique({
    where: { id: conversationId },
    select: { psid: true },
  });
  return row?.psid ?? null;
}

const UNANSWERED_BURST_WINDOW_MS = 90_000;

/** Inbound messages not yet answered (newer than the last outbound, within the
 *  burst window) — merged into a single turn by the owner. */
export async function getUnansweredMessengerMessages(
  conversationId: string,
  withinMs: number = UNANSWERED_BURST_WINDOW_MS,
) {
  const lastOutbound = await db.messengerMessage.findFirst({
    where: {
      conversationId,
      direction: { in: [LineMessageDirection.OUTBOUND_AI, LineMessageDirection.OUTBOUND_ADMIN] },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const windowStart = new Date(Date.now() - withinMs);
  const lowerBound =
    lastOutbound && lastOutbound.createdAt > windowStart ? lastOutbound.createdAt : windowStart;
  return db.messengerMessage.findMany({
    where: {
      conversationId,
      direction: LineMessageDirection.INBOUND,
      createdAt: { gt: lowerBound },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, text: true, messageType: true, imageUrl: true, intent: true, createdAt: true },
  });
}

/** Marks the conversation's last inbound/admin activity timestamps. */
export async function touchMessengerConversationActivity(input: {
  conversationId: string;
  lastCustomerMessageAt?: Date;
  lastAdminMessageAt?: Date;
}) {
  return db.messengerConversation.update({
    where: { id: input.conversationId },
    data: {
      lastCustomerMessageAt: input.lastCustomerMessageAt ?? undefined,
      lastAdminMessageAt: input.lastAdminMessageAt ?? undefined,
    },
    select: { id: true },
  });
}
