type Bucket = {
  count: number;
  resetAt: number;
};

const globalForRateLimit = globalThis as typeof globalThis & {
  __rateLimitBuckets?: Map<string, Bucket>;
};

const buckets =
  globalForRateLimit.__rateLimitBuckets ??
  (globalForRateLimit.__rateLimitBuckets = new Map<string, Bucket>());

const SWEEP_INTERVAL_MS = 60_000;
let lastSweepAt = 0;

const sweep = (now: number): void => {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
};

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

export const checkRateLimit = ({ key, limit, windowMs }: RateLimitOptions): RateLimitResult => {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    const next: Bucket = { count: 1, resetAt: now + windowMs };
    buckets.set(key, next);
    return { ok: true, remaining: limit - 1, resetAt: next.resetAt };
  }

  if (bucket.count >= limit) {
    return { ok: false, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count += 1;
  return { ok: true, remaining: limit - bucket.count, resetAt: bucket.resetAt };
};
