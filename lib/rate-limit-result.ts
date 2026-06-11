import type { RateLimitResult } from "@/lib/rate-limit";

export function buildRateLimitResult({
  count,
  limit,
  resetAt,
}: {
  count: number;
  limit: number;
  resetAt: number;
}): RateLimitResult {
  if (count > limit) {
    return { ok: false, remaining: 0, resetAt };
  }

  return { ok: true, remaining: Math.max(0, limit - count), resetAt };
}
