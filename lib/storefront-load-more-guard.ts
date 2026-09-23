import { headers } from "next/headers";
import { getClientIp } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Per-IP ceiling for the storefront "load more" Server Actions (related products
 * on /product/[slug], category grid on /products/[category]).
 *
 * Server Actions are POSTs, and proxy.ts only rate-limits GET/HEAD, so these
 * actions had no ceiling at all while each call reaches Postgres. The ceiling is
 * far above what a person can trigger (a category page auto-loads at most a few
 * pages; related products load on a button click), so it only bites scripted
 * loops. Kept separate from the search bucket (`storefront-search:`) so browsing
 * never eats into a visitor's search allowance.
 */
export const STOREFRONT_LOAD_MORE_RATE_LIMIT_PER_MINUTE = 60;
const STOREFRONT_LOAD_MORE_RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Upper bound for ids accepted by the load-more actions. Product and category
 * ids are cuids (25 chars); anything far longer is not a real id.
 */
export const STOREFRONT_ID_MAX_LENGTH = 64;

/**
 * True when this caller may run another load-more now. Failures are treated as
 * "allow": the limiter is a safety valve, and a hiccup in the throttle table
 * must not stop customers from browsing.
 */
export const allowStorefrontLoadMore = async (logLabel: string): Promise<boolean> => {
  try {
    const ip = getClientIp(await headers());
    const rate = await checkRateLimit({
      key: `storefront-loadmore:${ip}`,
      limit: STOREFRONT_LOAD_MORE_RATE_LIMIT_PER_MINUTE,
      windowMs: STOREFRONT_LOAD_MORE_RATE_LIMIT_WINDOW_MS,
    });
    return rate.ok;
  } catch (error) {
    console.error(`[${logLabel}] rate limit check failed`, error);
    return true;
  }
};
