import { db } from "@/lib/db";
import { Prisma, ShopeeSyncJobStatus, ShopeeSyncJobType } from "@/lib/generated/prisma";

/**
 * Shopee sync lock (Phase M — reliability).
 *
 * Prevents overlapping sync runs for the same (shop, jobType) — e.g. a slow
 * scheduled order pull piling up behind the next cron tick. Uses `ShopeeSyncJob`
 * with status RUNNING as a lightweight mutex and records the job outcome.
 *
 * A RUNNING job older than `staleMs` is treated as crashed and ignored, so a
 * process that died mid-run cannot wedge the lock forever.
 *
 * NOTE: acquire = check-then-create, so a sub-millisecond race between two
 * callers is theoretically possible; for cron-spaced + manual triggers this is
 * sufficient. A stricter guarantee would need a DB advisory lock.
 */

const DEFAULT_STALE_MS = 10 * 60 * 1000; // 10 minutes

/** Pure: is a RUNNING job still holding the lock (i.e. recent enough)? */
export function isLockHeld(
  runningStartedAt: Date | null | undefined,
  now: number,
  staleMs: number = DEFAULT_STALE_MS,
): boolean {
  if (!runningStartedAt) return false;
  return now - runningStartedAt.getTime() < staleMs;
}

export type SyncWork<T> = {
  value: T;
  itemsProcessed?: number;
  itemsFailed?: number;
  meta?: Prisma.InputJsonValue;
};

export type SyncLockOutcome<T> =
  | { skipped: true; reason: "LOCKED" }
  | { skipped: false; result: T };

export async function withShopeeSyncLock<T>(
  params: { shopRecordId: string; type: ShopeeSyncJobType; staleMs?: number },
  fn: () => Promise<SyncWork<T>>,
): Promise<SyncLockOutcome<T>> {
  const staleMs = params.staleMs ?? DEFAULT_STALE_MS;

  const existing = await db.shopeeSyncJob.findFirst({
    where: {
      shopRecordId: params.shopRecordId,
      type: params.type,
      status: ShopeeSyncJobStatus.RUNNING,
    },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true },
  });

  if (isLockHeld(existing?.startedAt, Date.now(), staleMs)) {
    return { skipped: true, reason: "LOCKED" };
  }

  const job = await db.shopeeSyncJob.create({
    data: {
      shopRecordId: params.shopRecordId,
      type: params.type,
      status: ShopeeSyncJobStatus.RUNNING,
      startedAt: new Date(),
      attemptCount: 1,
    },
    select: { id: true },
  });

  try {
    const out = await fn();
    await db.shopeeSyncJob.update({
      where: { id: job.id },
      data: {
        status: ShopeeSyncJobStatus.SUCCESS,
        finishedAt: new Date(),
        itemsProcessed: out.itemsProcessed ?? 0,
        itemsFailed: out.itemsFailed ?? 0,
        ...(out.meta !== undefined ? { metaJson: out.meta } : {}),
      },
    });
    return { skipped: false, result: out.value };
  } catch (error) {
    await db.shopeeSyncJob
      .update({
        where: { id: job.id },
        data: {
          status: ShopeeSyncJobStatus.FAILED,
          finishedAt: new Date(),
          lastError: error instanceof Error ? error.message.slice(0, 500) : "unknown",
        },
      })
      .catch(() => undefined);
    throw error;
  }
}
