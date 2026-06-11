import { db } from "@/lib/db";
import { buildRateLimitResult } from "@/lib/rate-limit-result";

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
  const windowEnd = new Date(nowMs + windowMs);

  const [bucket] = await db.$queryRaw<
    { count: number; windowEnd: Date }[]
  >`
    INSERT INTO "ApiThrottle" ("key", "count", "windowEnd", "updatedAt")
    VALUES (${key}, 1, ${windowEnd}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "ApiThrottle"."windowEnd" <= ${now} THEN 1
        ELSE "ApiThrottle"."count" + 1
      END,
      "windowEnd" = CASE
        WHEN "ApiThrottle"."windowEnd" <= ${now} THEN ${windowEnd}
        ELSE "ApiThrottle"."windowEnd"
      END,
      "updatedAt" = ${now}
    RETURNING "count", "windowEnd"
  `;

  void maybeSweepExpired(nowMs);

  if (!bucket) {
    return { ok: true, remaining: Math.max(0, limit - 1), resetAt: windowEnd.getTime() };
  }

  return buildRateLimitResult({
    count: Number(bucket.count),
    limit,
    resetAt: bucket.windowEnd.getTime(),
  });
};
