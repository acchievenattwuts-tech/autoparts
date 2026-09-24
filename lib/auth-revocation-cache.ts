import { isSessionRevisionInvalid } from "@/lib/auth-session-revocation";

/**
 * Per-user memo of the session-revocation lookup (User.authVersion / isActive).
 *
 * The jwt() callback in auth.config.ts runs on every auth() call: once in the
 * proxy for an /admin request and again for the page render, plus once per
 * prefetched admin link. Without a memo each of those is a DB round-trip for
 * the same two columns.
 *
 * Only a "still valid" answer is served from the cache. Whenever the cached row
 * would reject the token (different authVersion, user disabled) the row is read
 * again, so a stale entry can delay a revocation by at most the TTL but can
 * never reject a session that the database currently accepts — e.g. the fresh
 * token issued right after a password change carries the new authVersion and
 * forces a re-read instead of being compared with the old cached one.
 */

/** A disabled user or a bumped authVersion takes effect within this window. */
export const REVOCATION_CACHE_TTL_MS = 30_000;
const MAX_CACHED_USERS = 1_000;

export type UserAuthState = {
  authVersion: number;
  isActive: boolean;
};

type CachedUserAuthState = UserAuthState & { fetchedAt: number };

const cache = new Map<string, CachedUserAuthState>();

const evictIfFull = (now: number): void => {
  if (cache.size < MAX_CACHED_USERS) return;
  for (const [userId, entry] of cache) {
    if (now - entry.fetchedAt >= REVOCATION_CACHE_TTL_MS) cache.delete(userId);
  }
  if (cache.size >= MAX_CACHED_USERS) cache.clear();
};

export type IsSessionRevokedInput = {
  userId: string;
  tokenVersion: unknown;
  load: (userId: string) => Promise<UserAuthState | null>;
  now?: number;
};

/**
 * True when the session must be treated as revoked. Errors from `load`
 * propagate so the caller can fail closed.
 */
export async function isSessionRevoked({
  userId,
  tokenVersion,
  load,
  now = Date.now(),
}: IsSessionRevokedInput): Promise<boolean> {
  const cached = cache.get(userId);
  if (
    cached &&
    now - cached.fetchedAt < REVOCATION_CACHE_TTL_MS &&
    !isSessionRevisionInvalid({
      tokenVersion,
      currentVersion: cached.authVersion,
      isActive: cached.isActive,
    })
  ) {
    return false;
  }

  const current = await load(userId);
  if (current) {
    evictIfFull(now);
    cache.set(userId, { authVersion: current.authVersion, isActive: current.isActive, fetchedAt: now });
  } else {
    cache.delete(userId);
  }

  return isSessionRevisionInvalid({
    tokenVersion,
    currentVersion: current?.authVersion,
    isActive: current?.isActive,
  });
}

/** Test helper: forget every cached user. */
export function clearRevocationCache(): void {
  cache.clear();
}
