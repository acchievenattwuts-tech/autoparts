/**
 * Which storefront catalog requests count toward the per-IP limiter in proxy.ts.
 *
 * Next.js prefetches the pages behind visible links (the related-product and
 * featured-product cards: 8–16 per product page). Each prefetch is a GET to
 * /product/* marked with a `next-router-prefetch` or
 * `next-router-segment-prefetch` header. Counting them let a customer who
 * simply scrolled through a few product pages — or several customers sharing
 * one mobile-carrier IP — exhaust the limit and see "Too Many Requests".
 *
 * Prefetches are skipped; full page loads and real client navigations (a click,
 * which Next sends with `rsc` but no prefetch header) are still counted, so the
 * limit keeps its value against crawlers hammering product and search pages.
 */

type HeaderSource = Pick<Headers, "has">;

export const NEXT_ROUTER_PREFETCH_HEADER = "next-router-prefetch";
export const NEXT_ROUTER_SEGMENT_PREFETCH_HEADER = "next-router-segment-prefetch";

/** True for a Next.js link prefetch (full or per-segment). */
export function isNextRouterPrefetch(headers: HeaderSource): boolean {
  return headers.has(NEXT_ROUTER_PREFETCH_HEADER) || headers.has(NEXT_ROUTER_SEGMENT_PREFETCH_HEADER);
}

/** True when this request should count toward the storefront catalog rate limit. */
export function countsTowardStorefrontCatalogLimit(
  pathname: string,
  method: string,
  headers: HeaderSource,
): boolean {
  const upperMethod = method.toUpperCase();
  if (upperMethod !== "GET" && upperMethod !== "HEAD") return false;
  const isCatalogPath =
    pathname.startsWith("/product/") || pathname === "/products" || pathname.startsWith("/products/");
  if (!isCatalogPath) return false;
  return !isNextRouterPrefetch(headers);
}
