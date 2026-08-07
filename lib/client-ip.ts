/**
 * Single source of truth for "which IP is this request from".
 *
 * The same x-forwarded-for / x-real-ip walk was written three times (proxy.ts,
 * lib/login-rate-limit.ts, app/api/liff/tracking/[token]/route.ts), each with
 * slightly different fallback behaviour. Rate limiting is only as trustworthy
 * as the key it buckets on, so the parsing lives here and is covered by tests.
 *
 * Behind Vercel, `x-forwarded-for` is a comma-separated chain and the FIRST
 * entry is the client. Everything after it was appended by proxies we control,
 * so trusting entry 0 is correct here — it would not be on an origin exposed
 * directly to the internet.
 */

/** Returned when no usable address is present, so callers still get one bucket. */
export const UNKNOWN_CLIENT_IP = "unknown";

type HeaderSource = Pick<Headers, "get">;

/**
 * First non-empty entry of an x-forwarded-for chain, or null.
 * Exported for tests; prefer `getClientIp` at call sites.
 */
export const parseForwardedFor = (value: string | null | undefined): string | null => {
  if (!value) return null;
  for (const part of value.split(",")) {
    const candidate = part.trim();
    if (candidate) return candidate;
  }
  return null;
};

/**
 * Client IP for rate-limit bucketing, or `UNKNOWN_CLIENT_IP` when the request
 * carries no forwarding headers at all. Never returns an empty string — an
 * empty key would silently merge every anonymous caller into one bucket in some
 * stores and split them in others.
 */
export const getClientIp = (headers: HeaderSource): string =>
  parseForwardedFor(headers.get("x-forwarded-for")) ??
  headers.get("x-real-ip")?.trim() ??
  UNKNOWN_CLIENT_IP;

/**
 * Nullable variant for callers that want to skip adding an IP bucket entirely
 * rather than lump unidentifiable callers together (login throttling does this,
 * so one un-attributable request cannot lock out every other anonymous one).
 */
export const getClientIpOrNull = (headers: HeaderSource): string | null =>
  parseForwardedFor(headers.get("x-forwarded-for")) ??
  (headers.get("x-real-ip")?.trim() || null);
