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
}) {
  const now = new Date();
  return db.messengerConversation.upsert({
    where: { pageId_psid: { pageId: input.pageId, psid: input.psid } },
    update: {
      displayName: input.displayName ?? undefined,
      pictureUrl: input.pictureUrl ?? undefined,
      customerId: input.customerId ?? undefined,
    },
    create: {
      pageId: input.pageId,
      psid: input.psid,
      displayName: input.displayName ?? null,
      pictureUrl: input.pictureUrl ?? null,
      customerId: input.customerId ?? null,
      aiStatus: LineConversationAiStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
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
 * Whether this Messenger customer should see prices. Mirrors resolveLineShowPrice
 * but resolves via the conversation's linked customerId (Messenger has no direct
 * Customer.psid column — linkage is manual/admin-side).
 */
export async function resolveMessengerShowPrice(conversationId: string): Promise<boolean> {
  const conversation = await db.messengerConversation.findUnique({
    where: { id: conversationId },
    select: {
      customer: {
        select: { isActive: true, customerType: { select: { showPrice: true, isActive: true } } },
      },
    },
  });
  const customer = conversation?.customer;
  if (!customer?.isActive) return false;
  if (!customer.customerType?.isActive) return false;
  return customer.customerType.showPrice;
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
