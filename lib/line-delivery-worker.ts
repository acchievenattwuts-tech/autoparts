import { db } from "@/lib/db";
import type { Prisma, SaleLineDeliveryDispatch } from "@/lib/generated/prisma";
import { getDeliveryNotificationSkipReason } from "@/lib/line-delivery-policy";
import { LINE_DELIVERY_NOTIFICATIONS_KEY, LINE_DELIVERY_NOTIFICATIONS_DISABLED_AT_KEY, parseLineDeliveryNotificationsEnabled } from "@/lib/line-delivery-settings";
import { DeliveryLinePushError, pushDeliveryLineCard } from "@/lib/line-delivery-transport";

const LEASE_MS = 60_000;
const BATCH_SIZE = 10;
const BATCH_BUDGET_MS = 40_000;
const RETRY_BASE_MS = 60_000;
const RETRY_MAX_DELAY_MS = 60 * 60_000;
const RETRY_WINDOW_MS = 24 * 60 * 60_000 - 60_000;

const dueWhere = (now: Date): Prisma.SaleLineDeliveryDispatchWhereInput => ({
  OR: [
    { state: "PENDING", nextAttemptAt: { lte: now } },
    { state: "PROCESSING", leaseUntil: { lte: now } },
  ],
});

export const getDeliveryRetryAt = (firstAttemptAt: Date, now: Date, attempts: number): Date | null => {
  const deadline = firstAttemptAt.getTime() + RETRY_WINDOW_MS;
  const next = now.getTime() + Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 6));
  return next < deadline ? new Date(next) : null;
};

const claimDispatch = async (row: SaleLineDeliveryDispatch, now: Date): Promise<Date | null> => {
  try {
    const leaseUntil = new Date(now.getTime() + LEASE_MS);
    const claimed = await db.saleLineDeliveryDispatch.updateMany({
      where: { id: row.id, attemptCount: row.attemptCount, firstAttemptAt: row.firstAttemptAt, ...dueWhere(now) },
      data: { state: "PROCESSING", leaseUntil, firstAttemptAt: row.firstAttemptAt ?? now, attemptCount: { increment: 1 } },
    });
    return claimed.count > 0 ? leaseUntil : null;
  } catch (error) { throw error; }
};

const checkDispatchEligibility = async (row: SaleLineDeliveryDispatch): Promise<string | null> => {
  try {
    const [settings, sale] = await Promise.all([
      db.siteContent.findMany({ where: { key: { in: [LINE_DELIVERY_NOTIFICATIONS_KEY, LINE_DELIVERY_NOTIFICATIONS_DISABLED_AT_KEY] } }, select: { key: true, value: true } }),
      db.sale.findUnique({ where: { id: row.saleId }, select: {
        status: true, fulfillmentType: true, shippingMethod: true, shippingStatus: true, customerId: true,
        customer: { select: { id: true, isActive: true, phone: true, lineUserId: true, lineLinkedAt: true } },
      } }),
    ]);
    if (!sale) return "SALE_INACTIVE";
    if (row.eventStatus !== "OUT_FOR_DELIVERY" && row.eventStatus !== "DELIVERED") return "INVALID_EVENT";
    const disabledAtValue = settings.find(setting => setting.key === LINE_DELIVERY_NOTIFICATIONS_DISABLED_AT_KEY)?.value;
    if (disabledAtValue && row.eventAt.getTime() <= new Date(disabledAtValue).getTime()) return "DISABLED_BEFORE_DISPATCH";
    return getDeliveryNotificationSkipReason({
      enabled: parseLineDeliveryNotificationsEnabled(settings.find(setting => setting.key === LINE_DELIVERY_NOTIFICATIONS_KEY)?.value), sale, eventStatus: row.eventStatus,
      customerId: row.customerId, recipientLineUserId: row.recipientLineUserId,
    });
  } catch (error) { throw error; }
};

const finishDispatch = async (
  row: SaleLineDeliveryDispatch, leaseUntil: Date, data: Prisma.SaleLineDeliveryDispatchUpdateManyMutationInput,
): Promise<void> => {
  try {
    await db.saleLineDeliveryDispatch.updateMany({
      where: { id: row.id, state: "PROCESSING", leaseUntil },
      data: { ...data, leaseUntil: null },
    });
  } catch (error) { throw error; }
};

const handleDispatchFailure = async (row: SaleLineDeliveryDispatch, leaseUntil: Date, error: unknown): Promise<void> => {
  try {
    const now = new Date();
    const firstAttemptAt = row.firstAttemptAt ?? new Date(leaseUntil.getTime() - LEASE_MS);
    const retryAt = error instanceof DeliveryLinePushError && !error.retryable
      ? null : getDeliveryRetryAt(firstAttemptAt, now, row.attemptCount + 1);
    await finishDispatch(row, leaseUntil, {
      state: retryAt ? "PENDING" : "FAILED", nextAttemptAt: retryAt,
      lastErrorCode: error instanceof DeliveryLinePushError ? error.code : "DISPATCH_PROCESSING_ERROR",
    });
  } catch {
    // Leave the lease durable; the cron recovers it after expiry.
    console.error("[line-delivery] failed to persist attempt outcome");
  }
};

export const processSaleDeliveryLineDispatch = async (id: string): Promise<void> => {
  try {
    const row = await db.saleLineDeliveryDispatch.findUnique({ where: { id } });
    if (!row) return;
    const now = new Date();
    const leaseUntil = await claimDispatch(row, now);
    if (!leaseUntil) return;
    try {
      const skipReason = await checkDispatchEligibility(row);
      if (skipReason) {
        await finishDispatch(row, leaseUntil, { state: "SKIPPED", lastErrorCode: skipReason, nextAttemptAt: null });
        return;
      }
      const firstAttemptAt = row.firstAttemptAt ?? now;
      if (Date.now() - firstAttemptAt.getTime() >= RETRY_WINDOW_MS) {
        throw new DeliveryLinePushError("RETRY_WINDOW_EXPIRED", false);
      }
      const accessToken = process.env.LINE_MESSAGING_API_CHANNEL_ACCESS_TOKEN?.trim();
      if (!accessToken || !row.recipientLineUserId) throw new DeliveryLinePushError("LINE_CONFIG_MISSING", false);
      const result = await pushDeliveryLineCard({
        accessToken, recipientId: row.recipientLineUserId, retryKey: row.retryKey, payload: row.payload,
      });
      await finishDispatch(row, leaseUntil, {
        state: "ACCEPTED", acceptedAt: new Date(), lineRequestId: result.requestId, lastErrorCode: null, nextAttemptAt: null,
      });
    } catch (error) { await handleDispatchFailure(row, leaseUntil, error); }
  } catch {
    // Status action has already committed; recovery must never change its result.
    console.error("[line-delivery] dispatch deferred to recovery");
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
