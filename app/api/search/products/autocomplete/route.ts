/**
 * Phase Q1 — Storefront + Admin product autocomplete API.
 *
 * GET /api/search/products/autocomplete?q=...
 *   - Public endpoint (storefront search bar + admin product list search input both use it).
 *   - Returns active products only.
 *   - Min query length 2 chars, max 8 results.
 *   - Uses the same V2 engine as full search (Phase A-E + synonyms).
 */

import { NextResponse } from "next/server";
import type { Prisma } from "@/lib/generated/prisma";
import type { ProductSearchCacheProfile } from "@/lib/product-search-cache";
import { runStorefrontProductSearchWithRequiredTokenFallback } from "@/lib/storefront-product-search";
import { db } from "@/lib/db";
import { getProductPath } from "@/lib/product-slug";
import { logProductSearchTelemetry } from "@/lib/product-search-telemetry";
import { isLikelyBotUserAgent } from "@/lib/search-bot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 80;
const SEMANTIC_MIN_QUERY_LENGTH = 4;
const TAKE = 8;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 45;
const RATE_LIMIT_SWEEP_INTERVAL_MS = 5 * 60_000;

type LocalRateBucket = {
  count: number;
  resetAt: number;
};

const globalForAutocompleteRateLimit = globalThis as unknown as {
  autocompleteRateLimitBuckets?: Map<string, LocalRateBucket>;
  autocompleteRateLimitLastSweepAt?: number;
};

const rateLimitBuckets =
  globalForAutocompleteRateLimit.autocompleteRateLimitBuckets ?? new Map<string, LocalRateBucket>();
globalForAutocompleteRateLimit.autocompleteRateLimitBuckets = rateLimitBuckets;

const checkLocalRateLimit = ({
  key,
  limit,
  windowMs,
}: {
  key: string;
  limit: number;
  windowMs: number;
}): { ok: boolean; resetAt: number } => {
  const now = Date.now();
  if ((globalForAutocompleteRateLimit.autocompleteRateLimitLastSweepAt ?? 0) + RATE_LIMIT_SWEEP_INTERVAL_MS < now) {
    for (const [bucketKey, bucket] of rateLimitBuckets) {
      if (bucket.resetAt <= now) rateLimitBuckets.delete(bucketKey);
    }
    globalForAutocompleteRateLimit.autocompleteRateLimitLastSweepAt = now;
  }

  const existing = rateLimitBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, resetAt: now + windowMs };
  }

  existing.count += 1;
  return { ok: existing.count <= limit, resetAt: existing.resetAt };
};

type AutocompleteItem = {
  id: string;
  code: string;
  name: string;
  imageUrl: string | null;
  salePrice: number;
  stock: number;
  inStock: boolean;
  saleUnitName: string | null;
  reportUnitName: string;
  brand: string | null;
  category: string;
  /** Storefront product detail path (admin can use it too — admin's edit URL is built client-side). */
  href: string;
  /** Admin-only edit URL (always set; UI decides which to use). */
  adminHref: string;
};

const normalize = (raw: string | null): string => {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (trimmed.length > MAX_QUERY_LENGTH) return trimmed.slice(0, MAX_QUERY_LENGTH);
  return trimmed;
};

const clientIp = (request: Request): string => {
  const fwd = request.headers.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0].trim() || "unknown";
};

// Shared select + mapper so the V2 path and the bot-only lightweight path return
// the exact same item shape.
const AUTOCOMPLETE_SELECT = {
  id: true,
  slug: true,
  code: true,
  name: true,
  imageUrl: true,
  salePrice: true,
  saleUnitName: true,
  reportUnitName: true,
  stock: true,
  category: { select: { name: true, slug: true } },
  brand: { select: { name: true } },
} satisfies Prisma.ProductSelect;

const toAutocompleteItem = (
  p: Prisma.ProductGetPayload<{ select: typeof AUTOCOMPLETE_SELECT }>,
): AutocompleteItem => ({
  id: p.id,
  code: p.code,
  name: p.name,
  imageUrl: p.imageUrl,
  salePrice: Number(p.salePrice),
  stock: Number(p.stock),
  inStock: p.stock > 0,
  saleUnitName: p.saleUnitName,
  reportUnitName: p.reportUnitName,
  brand: p.brand?.name ?? null,
  category: p.category.name,
  href: getProductPath({ category: p.category, product: p }),
  adminHref: `/admin/products/${p.id}/preview`,
});

export const GET = async (request: Request): Promise<NextResponse> => {
  try {
    const url = new URL(request.url);
    const query = normalize(url.searchParams.get("q"));
    const cacheProfile: ProductSearchCacheProfile =
      url.searchParams.get("mode") === "admin" ? "admin" : "storefront";

    if (query.length < MIN_QUERY_LENGTH) {
      return NextResponse.json({ items: [] });
    }

    const rate = checkLocalRateLimit({
      key: `autocomplete:${clientIp(request)}`,
      limit: RATE_LIMIT_MAX_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    if (!rate.ok) {
      return NextResponse.json(
        { items: [] },
        { status: 429, headers: { "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)) } },
      );
    }

    const isBot = isLikelyBotUserAgent(request.headers.get("user-agent"));

    // Bot / crawler traffic gets a lightweight LIKE-contains lookup that holds a
    // single pooled connection only for the query itself — NOT the V2 engine,
    // whose trigram/EXISTS work runs inside a transaction (dbSearchTx). Under a
    // crawl those transactions queue on the small per-instance pool and surface as
    // P2028 ("unable to start a transaction") for real users + stall the LINE
    // webhook. Crawlers don't index this autocomplete endpoint, so contains-match
    // results are fine; real browsers (which always send a non-bot UA) keep V2.
    if (isBot) {
      const botProducts = await db.product.findMany({
        where: {
          isActive: true,
          ...(cacheProfile === "storefront" ? { isStorefrontVisible: true } : {}),
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { code: { contains: query, mode: "insensitive" } },
          ],
        },
        select: AUTOCOMPLETE_SELECT,
        orderBy: { createdAt: "desc" },
        take: TAKE,
      });
      const items = botProducts.map(toAutocompleteItem);
      return NextResponse.json(
        { items, totalCount: items.length },
        { headers: { "Cache-Control": "public, max-age=30, s-maxage=60" } },
      );
    }

    const shouldUseSemantic = !isBot && query.length >= SEMANTIC_MIN_QUERY_LENGTH;

    // Use the SAME required-token fallback wrapper as the full results pages
    // (storefront /products/search + admin /admin/products) so the dropdown's
    // count and items match exactly what the user lands on after clicking
    // through. Calling searchProductIds() directly here would skip the
    // required-token anchoring and return a much broader fuzzy set (e.g. a
    // part-number query showing 102 loose matches that collapse to 2 on the
    // results page).
    const { searchResult: result } = await runStorefrontProductSearchWithRequiredTokenFallback({
      query,
      isActive: true,
      ...(cacheProfile === "storefront" ? { isStorefrontVisible: true } : {}),
      take: TAKE,
      order: "createdAtDesc",
      cacheProfile,
      disableSemantic: !shouldUseSemantic,
      disableBroadFallback: true,
    });

    // Feed as-you-type misses into the Product Search Quality report. Fire-and-
    // forget; the telemetry helper itself only persists no/low-result (≤3),
    // non-noise queries and dedupes per hour, so prefix typing that returns many
    // results is naturally filtered out.
    void logProductSearchTelemetry({
      input: {
        query,
        isActive: true,
        ...(cacheProfile === "storefront" ? { isStorefrontVisible: true } : {}),
      },
      resultCount: result.total,
      source: cacheProfile === "admin" ? "admin" : "storefront",
      path: "/api/search/products/autocomplete",
      isBot,
    });

    if (result.ids.length === 0) {
      return NextResponse.json(
        { items: [] },
        { headers: { "Cache-Control": "public, max-age=30, s-maxage=60" } },
      );
    }

    const products = await db.product.findMany({
      where: { id: { in: result.ids } },
      select: AUTOCOMPLETE_SELECT,
    });

    // Preserve search ranking order
    const order = new Map(result.ids.map((id, idx) => [id, idx]));
    products.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    const items: AutocompleteItem[] = products.map(toAutocompleteItem);

    return NextResponse.json(
      { items, totalCount: result.total },
      { headers: { "Cache-Control": "public, max-age=30, s-maxage=60" } },
    );
  } catch (error) {
    console.error("[product autocomplete] failed", error);
    return NextResponse.json({ items: [], error: "INTERNAL_ERROR" }, { status: 500 });
  }
};
