import { db } from "@/lib/db";
import type { Prisma, SaleLineDeliveryDispatch } from "@/lib/generated/prisma";
import { getDeliveryNotificationSkipReason } from "@/lib/line-delivery-policy";
import { LINE_DELIVERY_NOTIFICATIONS_KEY, LINE_DELIVERY_NOTIFICATIONS_DISABLED_AT_KEY, parseLineDeliveryNotificationsEnabled } from "@/lib/line-delivery-settings";
import { DeliveryLinePushError, getDeliveryErrorLogCode, pushDeliveryLineCard } from "@/lib/line-delivery-transport";
import { safeNotifyLineDeliveryFailed } from "@/lib/notifications";

// Owner decision (T6): a card gets exactly one send attempt. Any failure ends the
// dispatch FAILED and alerts admins; nothing is ever retried or re-sent.
const LEASE_MS = 60_000;
const BATCH_SIZE = 10;
const BATCH_BUDGET_MS = 40_000;
/** A claim whose lease ran out mid-attempt (worker crashed or timed out): the send result is unknown. */
const LEASE_EXPIRED_ERROR_CODE = "LEASE_EXPIRED";
const DISPATCH_PROCESSING_ERROR_CODE = "DISPATCH_PROCESSING_ERROR";
const DAY_MS = 24 * 60 * 60_000;
export const LINE_DELIVERY_DISPATCH_RETENTION_DAYS = 60;
// Terminal outcomes only: PENDING and PROCESSING rows are still owed a send or skip decision.
const TERMINAL_DISPATCH_STATES = ["ACCEPTED", "SKIPPED", "FAILED"];
// Bounded like the other retention jobs: one run never holds a long DELETE or
// outlives the cron function; a larger backlog drains over the following runs.
const RETENTION_DELETE_BATCH_SIZE = 500;
const RETENTION_DELETE_MAX_BATCHES = 20;
const RETENTION_DELETE_TIME_BUDGET_MS = 20_000;

// PENDING rows were never attempted and get their single attempt. PROCESSING rows
// with an expired lease are only picked up to be closed as FAILED, never re-sent.
const dueWhere = (now: Date): Prisma.SaleLineDeliveryDispatchWhereInput => ({
  OR: [
    { state: "PENDING", nextAttemptAt: { lte: now } },
    { state: "PROCESSING", leaseUntil: { lte: now } },
  ],
});

// Only a never-attempted PENDING row can be claimed, so each card is attempted once.
const claimDispatch = async (row: SaleLineDeliveryDispatch, now: Date): Promise<Date | null> => {
  try {
    const leaseUntil = new Date(now.getTime() + LEASE_MS);
    const claimed = await db.saleLineDeliveryDispatch.updateMany({
      where: { id: row.id, state: "PENDING", attemptCount: 0, nextAttemptAt: { lte: now } },
      data: { state: "PROCESSING", leaseUntil, firstAttemptAt: now, attemptCount: { increment: 1 } },
    });
    return claimed.count > 0 ? leaseUntil : null;
  } catch (error) { throw error; }
};

/** Conditional FAILED write; only the caller whose condition still matched alerts, so racing runs alert once. */
const failWithoutSending = async (
  id: string, where: Prisma.SaleLineDeliveryDispatchWhereInput, data: Prisma.SaleLineDeliveryDispatchUpdateManyMutationInput,
): Promise<void> => {
  try {
    const failed = await db.saleLineDeliveryDispatch.updateMany({
      where: { ...where, id },
      data: { ...data, state: "FAILED", leaseUntil: null, nextAttemptAt: null },
    });
    if (failed.count > 0) await safeNotifyLineDeliveryFailed(id);
  } catch (error) { throw error; }
};

/**
 * Closes, without any LINE call, a row that must never be (re)sent. Returns true
 * when the row was not a fresh PENDING row, whether or not this call closed it.
 * - PROCESSING with an expired lease: the worker died mid-attempt and the send
 *   result is unknown, so it becomes FAILED `LEASE_EXPIRED`. A live lease is left alone.
 * - PENDING that was already attempted: a retry scheduled before the
 *   single-attempt policy; it becomes FAILED with its last error code kept.
 */
const closeUnsendableDispatch = async (row: SaleLineDeliveryDispatch, now: Date): Promise<boolean> => {
  try {
    if (row.state === "PROCESSING") {
      if (row.leaseUntil && row.leaseUntil.getTime() <= now.getTime()) {
        await failWithoutSending(row.id, { state: "PROCESSING", leaseUntil: row.leaseUntil }, { lastErrorCode: LEASE_EXPIRED_ERROR_CODE });
      }
      return true;
    }
    if (row.state === "PENDING" && row.attemptCount > 0) {
      await failWithoutSending(row.id, { state: "PENDING", attemptCount: row.attemptCount }, {});
      return true;
    }
    return false;
  } catch (error) { throw error; }
};

const checkDispatchEligibility = async (row: SaleLineDeliveryDispatch): Promise<string | null> => {
  try {
    const [settings, sale, deliveredDispatch] = await Promise.all([
      db.siteContent.findMany({ where: { key: { in: [LINE_DELIVERY_NOTIFICATIONS_KEY, LINE_DELIVERY_NOTIFICATIONS_DISABLED_AT_KEY] } }, select: { key: true, value: true } }),
      db.sale.findUnique({ where: { id: row.saleId }, select: {
        status: true, channel: true, fulfillmentType: true, shippingMethod: true, shippingStatus: true, customerId: true, saleDate: true,
        customer: { select: { id: true, isActive: true, phone: true, lineUserId: true, lineLinkedAt: true } },
      } }),
      // A queued "out for delivery" card must not follow a sent, pending or unknown-result "delivered" card.
      row.eventStatus === "OUT_FOR_DELIVERY"
        ? db.saleLineDeliveryDispatch.findUnique({
          where: { saleId_eventStatus: { saleId: row.saleId, eventStatus: "DELIVERED" } }, select: { state: true, lastErrorCode: true },
        })
        : null,
    ]);
    if (!sale) return "SALE_INACTIVE";
    if (row.eventStatus !== "OUT_FOR_DELIVERY" && row.eventStatus !== "DELIVERED") return "INVALID_EVENT";
    const disabledAtValue = settings.find(setting => setting.key === LINE_DELIVERY_NOTIFICATIONS_DISABLED_AT_KEY)?.value;
    if (disabledAtValue && row.eventAt.getTime() <= new Date(disabledAtValue).getTime()) return "DISABLED_BEFORE_DISPATCH";
    return getDeliveryNotificationSkipReason({
      enabled: parseLineDeliveryNotificationsEnabled(settings.find(setting => setting.key === LINE_DELIVERY_NOTIFICATIONS_KEY)?.value), sale, eventStatus: row.eventStatus,
      eventAt: row.eventAt, customerId: row.customerId, recipientLineUserId: row.recipientLineUserId,
      deliveredDispatchState: deliveredDispatch?.state ?? null, deliveredDispatchErrorCode: deliveredDispatch?.lastErrorCode ?? null,
    });
  } catch (error) { throw error; }
};

/** Returns false when this worker no longer held the lease, so the outcome was not written. */
const finishDispatch = async (
  row: SaleLineDeliveryDispatch, leaseUntil: Date, data: Prisma.SaleLineDeliveryDispatchUpdateManyMutationInput,
): Promise<boolean> => {
  try {
    const finished = await db.saleLineDeliveryDispatch.updateMany({
      where: { id: row.id, state: "PROCESSING", leaseUntil },
      data: { ...data, leaseUntil: null },
    });
    return finished.count > 0;
  } catch (error) { throw error; }
};

// Every failure (LINE non-2xx including 429/5xx, network error, timeout, missing
// configuration, processing error) is terminal: no retry is ever scheduled.
const handleDispatchFailure = async (row: SaleLineDeliveryDispatch, leaseUntil: Date, error: unknown): Promise<void> => {
  try {
    const finished = await finishDispatch(row, leaseUntil, {
      state: "FAILED", nextAttemptAt: null,
      lastErrorCode: error instanceof DeliveryLinePushError ? error.code : DISPATCH_PROCESSING_ERROR_CODE,
    });
    // Only the worker that wrote the terminal FAILED state alerts admins.
    if (finished) await safeNotifyLineDeliveryFailed(row.id);
  } catch (persistError) {
    // Leave the lease durable; once it expires the cron closes the row as LEASE_EXPIRED.
    console.error("[line-delivery] failed to persist attempt outcome", { code: getDeliveryErrorLogCode(persistError), dispatchId: row.id });
  }
};

export const processSaleDeliveryLineDispatch = async (id: string): Promise<void> => {
  try {
    const row = await db.saleLineDeliveryDispatch.findUnique({ where: { id } });
    if (!row) return;
    const now = new Date();
    if (await closeUnsendableDispatch(row, now)) return;
    const leaseUntil = await claimDispatch(row, now);
    if (!leaseUntil) return;
    let result: { requestId: string | null };
    try {
      const skipReason = await checkDispatchEligibility(row);
      if (skipReason) {
        await finishDispatch(row, leaseUntil, { state: "SKIPPED", lastErrorCode: skipReason, nextAttemptAt: null });
        return;
      }
      const accessToken = process.env.LINE_MESSAGING_API_CHANNEL_ACCESS_TOKEN?.trim();
      if (!accessToken || !row.recipientLineUserId) throw new DeliveryLinePushError("LINE_CONFIG_MISSING");
      result = await pushDeliveryLineCard({
        accessToken, recipientId: row.recipientLineUserId, retryKey: row.retryKey, payload: row.payload,
      });
    } catch (error) {
      await handleDispatchFailure(row, leaseUntil, error);
      return;
    }
    // LINE accepted the card. If this write fails the lease is left to expire and
    // the cron closes the row as LEASE_EXPIRED: never re-sent, never labelled a send error.
    await finishDispatch(row, leaseUntil, {
      state: "ACCEPTED", acceptedAt: new Date(), lineRequestId: result.requestId, lastErrorCode: null, nextAttemptAt: null,
    });
  } catch (error) {
    // Status action has already committed; recovery must never change its result.
    console.error("[line-delivery] dispatch deferred to recovery", { code: getDeliveryErrorLogCode(error), dispatchId: id });
  }
};

export const processPendingSaleDeliveryLineDispatches = async (): Promise<number> => {
  try {
    const start = Date.now();
    const rows = await db.saleLineDeliveryDispatch.findMany({
      where: dueWhere(new Date()), orderBy: { createdAt: "asc" }, take: BATCH_SIZE, select: { id: true },
    });
    let processed = 0;
    for (const row of rows) {
      if (Date.now() - start >= BATCH_BUDGET_MS) break;
      await processSaleDeliveryLineDispatch(row.id);
      processed += 1;
    }
    return processed;
  } catch (error) { throw error; }
};

/**
 * Deletes terminal dispatch rows (they keep the recipient LINE user id and the
 * customer name inside the card payload) once their last write — the terminal
 * transition, stamped in `updatedAt` — is older than the retention window.
 * Returns the number of deleted rows only.
 */
export const deleteExpiredSaleDeliveryDispatches = async (now: Date = new Date()): Promise<number> => {
  try {
    const cutoff = new Date(now.getTime() - LINE_DELIVERY_DISPATCH_RETENTION_DAYS * DAY_MS);
    const expiredWhere: Prisma.SaleLineDeliveryDispatchWhereInput = {
      state: { in: TERMINAL_DISPATCH_STATES }, updatedAt: { lt: cutoff },
    };
    const startedAt = Date.now();
    let deleted = 0;
    for (let batch = 0; batch < RETENTION_DELETE_MAX_BATCHES; batch += 1) {
      if (Date.now() - startedAt >= RETENTION_DELETE_TIME_BUDGET_MS) break;
      const rows = await db.saleLineDeliveryDispatch.findMany({
        where: expiredWhere, take: RETENTION_DELETE_BATCH_SIZE, select: { id: true },
      });
      if (rows.length === 0) break;
      // The delete repeats the terminal/age filter, so only rows that still match are removed.
      const result = await db.saleLineDeliveryDispatch.deleteMany({
        where: { AND: [{ id: { in: rows.map(row => row.id) } }, expiredWhere] },
      });
      deleted += result.count;
      if (rows.length < RETENTION_DELETE_BATCH_SIZE) break;
    }
    return deleted;
  } catch (error) { throw error; }
};
