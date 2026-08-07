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

export async function recordFailedLogin(keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const lockedUntil = new Date(now.getTime() + LOCKOUT_MS);

  const existing = await db.loginThrottle.findMany({
    where: { key: { in: keys } },
  });
  const existingMap = new Map(existing.map((record) => [record.key, record]));

  await db.$transaction(
    keys.map((key) => {
      const current = existingMap.get(key);

      if (!current) {
        return db.loginThrottle.create({
          data: {
            key,
            failures: 1,
            firstFailureAt: now,
            lockedUntil: null,
          },
        });
      }

      const withinWindow =
        current.firstFailureAt !== null && current.firstFailureAt >= windowStart;
      const failures = withinWindow ? current.failures + 1 : 1;

      return db.loginThrottle.update({
        where: { key },
        data: {
          failures,
          firstFailureAt: withinWindow ? current.firstFailureAt : now,
          lockedUntil: failures >= MAX_ATTEMPTS ? lockedUntil : null,
        },
      });
    })
  );
}

export async function clearFailedLogins(keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  await db.loginThrottle.deleteMany({
    where: { key: { in: keys } },
  });
}
