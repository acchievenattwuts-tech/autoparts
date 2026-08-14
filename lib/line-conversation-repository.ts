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

/**
 * ตัดสินว่าลูกค้า LINE รายนี้ใช้ระดับราคาไหนบนแชท/Flex
 * WHOLESALE → ผูกบัญชีแล้ว + ประเภทลูกค้า (active) มี priceTier=WHOLESALE (เช่น อู่ซ่อมรถ)
 * MEMBER    → ผูกบัญชีแล้ว + ประเภทลูกค้า (active) มี priceTier=MEMBER (สมาชิก) → ใช้ Product.memberPrice
 * RETAIL    → ผูกบัญชีแล้ว + ประเภทลูกค้า (active) มี priceTier=RETAIL (ลูกค้าทั่วไป)
 * UNLINKED  → ยังไม่ผูกบัญชี / บัญชีถูกปิด / ไม่ระบุประเภท / ประเภทถูกปิดใช้งาน
 *             ใช้ราคาขายปลีกเหมือน RETAIL แต่แยกค่าไว้เพื่อแนบข้อความว่าราคายังไม่ได้ลด
 *             (ยืนยันโดยเจ้าของร้าน 2026-07-19: 3 กรณีหลังนับเป็น "ยังไม่ผูก")
 */
export async function resolveLinePriceTier(
  lineUserId: string,
): Promise<"UNLINKED" | "RETAIL" | "MEMBER" | "WHOLESALE"> {
  const customer = await db.customer.findUnique({
    where: { lineUserId },
    select: {
      isActive: true,
      customerType: { select: { priceTier: true, isActive: true } },
    },
  });
  if (!customer?.isActive) return "UNLINKED";
  if (!customer.customerType?.isActive) return "UNLINKED";
  return customer.customerType.priceTier;
}

/**
 * Lightweight profile snapshot for the webhook's "can we skip the LINE profile
 * API call this turn?" check (Option B): when the conversation already holds a
 * displayName and the customer was recently active, the stored values are reused
 * instead of paying a LINE API round-trip on every inbound event.
 */
export async function getLineConversationProfileSnapshot(lineUserId: string): Promise<{
  displayName: string | null;
  pictureUrl: string | null;
  lastCustomerMessageAt: Date | null;
} | null> {
  return db.lineConversation.findUnique({
    where: { lineUserId },
    select: { displayName: true, pictureUrl: true, lastCustomerMessageAt: true },
  });
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
    select: { id: true, direction: true, text: true, messageType: true, createdAt: true },
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

/**
 * Returns the stored vision classification (job payload `imageClassification`)
 * for each given inbound-message row id (B2a). Lets an owner re-run / the cron
 * recovery — which start with an empty in-memory cache — reuse the ingest-time
 * classification instead of paying for a second Gemini vision call. Keyed by the
 * inbound LineMessage row id; only rows with a stored classification appear.
 */
export async function getStoredImageClassificationsByMessageRowIds(
  messageRowIds: string[],
): Promise<Map<string, unknown>> {
  const result = new Map<string, unknown>();
  if (messageRowIds.length === 0) return result;
  const rows = await db.lineAiJob.findMany({
    where: { lineMessageId: { in: messageRowIds } },
    orderBy: { createdAt: "asc" },
    select: { lineMessageId: true, payload: true },
  });
  for (const row of rows) {
    if (!row.lineMessageId || !row.payload || typeof row.payload !== "object") continue;
    const classification = (row.payload as Record<string, unknown>).imageClassification;
    // Latest-wins: rows are ascending, so a later ingest overwrites an earlier one.
    if (classification && typeof classification === "object") {
      result.set(row.lineMessageId, classification);
    }
  }
  return result;
}

/**
 * Persists a vision classification onto the image message's most recent job
 * payload so a later owner re-run / cron recovery reuses it instead of paying
 * for a second Gemini call (B2a).
 *
 * Needed because vision no longer runs at ingest time for coalesced turns: the
 * owner classifies on demand, so the owner is now the one that has to write the
 * reuse copy that ingest used to write.
 */
export async function storeImageClassificationForMessage(input: {
  lineMessageRowId: string;
  classification: JsonInput;
}): Promise<void> {
  const job = await db.lineAiJob.findFirst({
    where: { lineMessageId: input.lineMessageRowId },
    orderBy: { createdAt: "desc" },
    select: { id: true, payload: true },
  });
  if (!job) return;
  const payload =
    job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
      ? (job.payload as Record<string, unknown>)
      : {};
  await db.lineAiJob.update({
    where: { id: job.id },
    data: { payload: { ...payload, imageClassification: input.classification } as JsonInput },
  });
}

/**
 * Corrects the stored intent of an inbound image row once vision has classified
 * it. Ingest can only record the generic `PART_IMAGE_INQUIRY` for an image (the
 * classification hasn't run yet), so without this a payment slip would keep the
 * wrong intent label in the admin conversation view.
 */
export async function updateLineMessageIntent(input: {
  id: string;
  intent: LineIntent;
}): Promise<void> {
  await db.lineMessage.update({
    where: { id: input.id },
    data: { intent: input.intent },
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

/** Coalescing crash failsafe: conversations that have customer messages newer
 *  than the last AI reply (lastInboundSeq > lastProcessedSeq), are not currently
 *  owned by a live worker (lock free or lease expired), and have been quiet long
 *  enough that a live owner would already have finished. The cron re-runs the
 *  owner loop for these so a crashed webhook never leaves a customer unanswered. */
export async function findStalledCoalescedConversationIds(input: {
  quietBefore: Date;
  take: number;
}): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "LineConversation"
    WHERE "lastInboundSeq" > "lastProcessedSeq"
      AND ("processingOwner" IS NULL OR "processingLeaseUntil" < NOW())
      AND "lastCustomerMessageAt" IS NOT NULL
      AND "lastCustomerMessageAt" < ${input.quietBefore}
    ORDER BY "lastCustomerMessageAt" ASC
    LIMIT ${input.take}`;
  return rows.map((row) => row.id);
}

/** Full conversation row used to rebuild the owner-loop context during recovery. */
export async function getLineConversationForRecovery(conversationId: string) {
  return db.lineConversation.findUnique({ where: { id: conversationId } });
}

/** Reads the persisted inquiry frame (conversation slot memory) + its freshness
 *  stamp, so the AI can continue the same product subject across turns. */
export async function getLineInquiryFrame(conversationId: string): Promise<{
  partType: string | null;
  carBrand: string | null;
  carModel: string | null;
  year: number | null;
  updatedAt: Date | null;
} | null> {
  const row = await db.lineConversation.findUnique({
    where: { id: conversationId },
    select: {
      inquiryPartType: true,
      inquiryCarBrand: true,
      inquiryCarModel: true,
      inquiryYear: true,
      inquiryUpdatedAt: true,
    },
  });
  if (!row) return null;
  return {
    partType: row.inquiryPartType,
    carBrand: row.inquiryCarBrand,
    carModel: row.inquiryCarModel,
    year: row.inquiryYear,
    updatedAt: row.inquiryUpdatedAt,
  };
}

/** Persists the reconciled inquiry frame and stamps the update time. */
export async function updateLineInquiryFrame(input: {
  conversationId: string;
  partType: string | null;
  carBrand: string | null;
  carModel: string | null;
  year: number | null;
}): Promise<void> {
  await db.lineConversation.update({
    where: { id: input.conversationId },
    data: {
      inquiryPartType: input.partType,
      inquiryCarBrand: input.carBrand,
      inquiryCarModel: input.carModel,
      inquiryYear: input.year,
      inquiryUpdatedAt: new Date(),
    },
  });
}

/** A coalesced burst only ever spans the live debounce + abort-on-newer window
 *  (≤ ~90s) plus the recovery delay, so we never gather messages older than this.
 *  This is the safety net for stale "unanswered" rows: when an admin replies
 *  MANUALLY via the LINE OA console, that reply never reaches our webhook and is
 *  not stored as an outbound row, so an old customer message would otherwise look
 *  "unanswered" for hours and get merged into an unrelated later burst (e.g. a
 *  payment slip). Bounding by time keeps a burst = the recent burst only. */
const UNANSWERED_LINE_BURST_WINDOW_MS = 5 * 60_000;

/** Inbound customer messages of the CURRENT burst: those that arrived after the
 *  most recent outbound reply AND within the recent burst window (oldest →
 *  newest). Time-bounded so hours-old, already-handled messages never get pulled
 *  into a new, unrelated turn. */
export async function getUnansweredInboundLineMessages(
  conversationId: string,
  withinMs: number = UNANSWERED_LINE_BURST_WINDOW_MS,
) {
  const lastOutbound = await db.lineMessage.findFirst({
    where: {
      conversationId,
      direction: { in: [LineMessageDirection.OUTBOUND_AI, LineMessageDirection.OUTBOUND_ADMIN] },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const windowStart = new Date(Date.now() - withinMs);
  // Lower bound = the later of (last outbound, window start) — so neither a stale
  // outbound marker nor an unbounded backlog can widen the burst.
  const lowerBound =
    lastOutbound && lastOutbound.createdAt > windowStart ? lastOutbound.createdAt : windowStart;
  return db.lineMessage.findMany({
    where: {
      conversationId,
      direction: LineMessageDirection.INBOUND,
      createdAt: { gt: lowerBound },
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
