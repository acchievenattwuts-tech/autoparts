import { db } from "@/lib/db";
import { getClientIpOrNull } from "@/lib/client-ip";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000;
const LOCKOUT_MS = 5 * 60 * 1000;
const USERNAME_PREFIX = "username:";
const IP_PREFIX = "ip:";

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function buildThrottleKeys(username: string, ip: string | null): string[] {
  const keys = [`${USERNAME_PREFIX}${normalizeUsername(username)}`];
  if (ip) keys.push(`${IP_PREFIX}${ip}`);
  return keys;
}

export function getLoginThrottleKeys(username: string, request: Request): string[] {
  // Nullable on purpose: an attempt we cannot attribute to an IP adds no IP
  // bucket, so it can never contribute to locking out other anonymous callers.
  return buildThrottleKeys(username, getClientIpOrNull(request.headers));
}

export async function isLoginBlocked(keys: string[]): Promise<boolean> {
  if (keys.length === 0) return false;

  const now = new Date();
  const records = await db.loginThrottle.findMany({
    where: { key: { in: keys } },
    select: { lockedUntil: true },
  });

  return records.some((record) => record.lockedUntil && record.lockedUntil > now);
}

/**
 * Counts one failed attempt against every key in a single atomic statement per
 * key, so parallel failures can neither lose increments nor collide on the
 * first insert (a unique-key error that surfaced as a NextAuth "Configuration"
 * error). The lockout is decided inside the same statement from the
 * incremented count. The rules are unchanged from the earlier read-then-write
 * version: a failure outside the window restarts the count at 1, and reaching
 * MAX_ATTEMPTS inside the window locks the key for LOCKOUT_MS.
 */
export async function recordFailedLogin(keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const lockedUntil = new Date(now.getTime() + LOCKOUT_MS);

  await db.$transaction(
    keys.map(
      (key) => db.$queryRaw<{ failures: number }[]>`
        INSERT INTO "LoginThrottle" ("key", "failures", "firstFailureAt", "lockedUntil", "createdAt", "updatedAt")
        VALUES (${key}, 1, ${now}, NULL, ${now}, ${now})
        ON CONFLICT ("key") DO UPDATE SET
          "failures" = CASE
            WHEN "LoginThrottle"."firstFailureAt" >= ${windowStart} THEN "LoginThrottle"."failures" + 1
            ELSE 1
          END,
          "firstFailureAt" = CASE
            WHEN "LoginThrottle"."firstFailureAt" >= ${windowStart} THEN "LoginThrottle"."firstFailureAt"
            ELSE ${now}
          END,
          "lockedUntil" = CASE
            WHEN (
              CASE
                WHEN "LoginThrottle"."firstFailureAt" >= ${windowStart} THEN "LoginThrottle"."failures" + 1
                ELSE 1
              END
            ) >= ${MAX_ATTEMPTS} THEN ${lockedUntil}::timestamptz
            ELSE NULL
          END,
          "updatedAt" = ${now}
        RETURNING "failures"
      `,
    ),
  );
}

/**
 * Claims the first refused attempt of the current lock round, so a locked-out
 * caller produces one LOGIN_BLOCKED audit row per round instead of one row per
 * request (refused attempts are never counted, so without this an attacker could
 * add audit rows without limit while locked).
 *
 * recordFailedLogin() sets `updatedAt` to the moment of the failure that locks
 * the key and `lockedUntil` to exactly LOCKOUT_MS later, and nothing else writes
 * a locked row until the lock ends. So "lockedUntil - updatedAt >= LOCKOUT_MS"
 * means "not claimed yet"; the claim moves `updatedAt` forward by at least 1 ms
 * (even when the refused attempt lands in the same millisecond as the lock),
 * which makes the gap smaller and the row unclaimable for the rest of the round. A new lock round
 * (recordFailedLogin after the lock) resets both columns and can be claimed again.
 * The lock itself (`lockedUntil`) is never changed, and concurrent refused
 * attempts serialize on the row lock, so exactly one of them wins.
 */
export async function claimLoginBlockedAudit(keys: string[]): Promise<boolean> {
  if (keys.length === 0) return false;

  const now = new Date();
  const claimed = await db.$executeRaw`
    UPDATE "LoginThrottle"
    SET "updatedAt" = GREATEST(${now}::timestamptz, "updatedAt" + INTERVAL '1 millisecond')
    WHERE "key" = ANY(${keys}::text[])
      AND "lockedUntil" > ${now}
      AND "lockedUntil" - "updatedAt" >= ${LOCKOUT_MS}::double precision * INTERVAL '1 millisecond'
  `;
  return claimed > 0;
}

export async function clearFailedLogins(keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  await db.loginThrottle.deleteMany({
    where: { key: { in: keys } },
  });
}
