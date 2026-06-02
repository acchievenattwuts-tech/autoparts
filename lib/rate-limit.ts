import { db } from "@/lib/db";

export type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: number;
};

const CLEANUP_PROBABILITY = 0.002;
const CLEANUP_GRACE_MS = 60_000;

const maybeSweepExpired = async (now: number): Promise<void> => {
  if (Math.random() >= CLEANUP_PROBABILITY) return;
  try {
    await db.apiThrottle.deleteMany({
      where: { windowEnd: { lt: new Date(now - CLEANUP_GRACE_MS) } },
    });
  } catch {
    // Cleanup is best-effort; ignore errors so they never block a request.
  }
};

/**
 * Centralized rate limit backed by Postgres so counters stay consistent across
 * every serverless instance. Each `key` is one sliding bucket whose window
 * resets when `windowEnd` elapses.
 */
export const checkRateLimit = async ({
  key,
  limit,
  windowMs,
}: RateLimitOptions): Promise<RateLimitResult> => {
  const now = new Date();
  const nowMs = now.getTime();

  const incremented = await db.apiThrottle.updateMany({
    where: { key, windowEnd: { gt: now } },
    data: { count: { increment: 1 } },
  });

  if (incremented.count === 0) {
    const windowEnd = new Date(nowMs + windowMs);
    await db.apiThrottle.upsert({
      where: { key },
      create: { key, count: 1, windowEnd },
      update: { count: 1, windowEnd },
    });
    void maybeSweepExpired(nowMs);
    return { ok: true, remaining: Math.max(0, limit - 1), resetAt: windowEnd.getTime() };
  }

  const bucket = await db.apiThrottle.findUnique({
    where: { key },
    select: { count: true, windowEnd: true },
  });

  if (!bucket) {
    return { ok: true, remaining: Math.max(0, limit - 1), resetAt: nowMs + windowMs };
  }

  const resetAt = bucket.windowEnd.getTime();
  if (bucket.count > limit) {
    return { ok: false, remaining: 0, resetAt };
  }
  return { ok: true, remaining: Math.max(0, limit - bucket.count), resetAt };
};
