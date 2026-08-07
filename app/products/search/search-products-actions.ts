"use server";

import { headers } from "next/headers";
import { z } from "zod";
import {
  getStorefrontProductSearchPageData,
  STOREFRONT_PRODUCTS_PER_PAGE,
} from "@/lib/storefront-product-search";
import type { SearchProductsResult } from "@/lib/storefront-product-search";
import { logProductSearchTelemetry } from "@/lib/product-search-telemetry";
import { isLikelyBotUserAgent } from "@/lib/search-bot";
import { getClientIp } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  EMPTY_SEARCH_RESULT,
  RATE_LIMITED_SEARCH_RESULT,
} from "@/lib/storefront-search-result-states";

const SearchInputSchema = z.object({
  q: z.string().max(200).optional(),
  category: z.string().max(200).optional(),
  brand: z.string().max(200).optional(),
  models: z.array(z.string().max(200)).max(50).default([]),
  year: z.number().int().min(1900).max(2200).nullable().optional(),
  page: z.number().int().min(1).max(500).default(1),
  // Multi-select filter UI v2
  categories: z.array(z.string().max(200)).max(50).default([]),
  partsBrands: z.array(z.string().max(64)).max(50).default([]),
  carBrands: z.array(z.string().max(200)).max(50).default([]),
  yearMin: z.number().int().min(1900).max(2200).nullable().optional(),
  yearMax: z.number().int().min(1900).max(2200).nullable().optional(),
  priceMin: z.number().min(0).max(99_999_999).nullable().optional(),
  priceMax: z.number().min(0).max(99_999_999).nullable().optional(),
});

export type SearchFilterInput = z.infer<typeof SearchInputSchema>;

const EMPTY_RESULT = EMPTY_SEARCH_RESULT;
const RATE_LIMITED_RESULT = RATE_LIMITED_SEARCH_RESULT;

// Matches the storefront-catalog ceiling proxy.ts applies to GET /products, so
// the two entry points into the same search engine cost the same.
//
// These actions POST to the page URL, and proxy.ts only rate-limits GET/HEAD —
// so the heaviest unauthenticated query in the system (trigram + semantic +
// EXISTS subqueries, several seconds of Postgres time each) was reachable with
// no ceiling at all. Enforced here rather than in the proxy so a throttled
// caller gets a typed result the UI can explain, instead of a raw 429 that
// would surface as a broken Server Action.
const SEARCH_RATE_LIMIT_PER_MINUTE = 60;
const SEARCH_RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * True when this caller may run a search now. Failures are treated as "allow":
 * the limiter is a safety valve, and a hiccup in the throttle table must not
 * take storefront search down.
 */
const allowStorefrontSearch = async (): Promise<boolean> => {
  try {
    const ip = getClientIp(await headers());
    const rate = await checkRateLimit({
      key: `storefront-search:${ip}`,
      limit: SEARCH_RATE_LIMIT_PER_MINUTE,
      windowMs: SEARCH_RATE_LIMIT_WINDOW_MS,
    });
    return rate.ok;
  } catch (error) {
    console.error("[searchProductsAction] rate limit check failed", error);
    return true;
  }
};

const getSearchProductsResult = async (
  input: SearchFilterInput,
): Promise<SearchProductsResult> =>
  getStorefrontProductSearchPageData({
    q: input.q,
    category: input.category,
    brand: input.brand,
    models: input.models,
    year: input.year ?? null,
    page: input.page,
    categories: input.categories,
    partsBrands: input.partsBrands,
    carBrands: input.carBrands,
    yearMin: input.yearMin ?? null,
    yearMax: input.yearMax ?? null,
    priceMin: input.priceMin ?? null,
    priceMax: input.priceMax ?? null,
  });

export async function searchProductsAction(
  input: SearchFilterInput,
): Promise<SearchProductsResult> {
  const parsed = SearchInputSchema.safeParse(input);
  if (!parsed.success) return EMPTY_RESULT;
  if (!(await allowStorefrontSearch())) return RATE_LIMITED_RESULT;

  const {
    q,
    category,
    brand,
    models,
    year,
    page,
    categories,
    partsBrands,
    carBrands,
    yearMin,
    yearMax,
    priceMin,
    priceMax,
  } = parsed.data;
  const skip = (page - 1) * STOREFRONT_PRODUCTS_PER_PAGE;

  const searchInput = {
    query: q,
    isActive: true,
    isStorefrontVisible: true,
    categoryName: category,
    carBrandName: brand,
    carModelNames: models,
    fitmentYear: year ?? null,
    categoryNames: categories,
    brandIds: partsBrands,
    carBrandNames: carBrands,
    yearMin: yearMin ?? null,
    yearMax: yearMax ?? null,
    priceMin: priceMin ?? null,
    priceMax: priceMax ?? null,
    skip,
    take: STOREFRONT_PRODUCTS_PER_PAGE,
    order: "createdAtDesc",
    cacheProfile: "storefront",
  } as const;

  try {
    const result = await getSearchProductsResult(parsed.data);

    const userAgent = (await headers()).get("user-agent");
    await logProductSearchTelemetry({
      input: searchInput,
      resultCount: result.total,
      source: "storefront",
      path: "/products/search",
      isBot: isLikelyBotUserAgent(userAgent),
    });
    return result;
  } catch (error) {
    console.error("[searchProductsAction] failed", error);
    return EMPTY_RESULT;
  }
}

export async function loadMoreSearchProductsAction(
  input: SearchFilterInput,
): Promise<SearchProductsResult> {
  const parsed = SearchInputSchema.safeParse(input);
  if (!parsed.success) return EMPTY_RESULT;
  if (!(await allowStorefrontSearch())) return RATE_LIMITED_RESULT;

  try {
    return await getSearchProductsResult(parsed.data);
  } catch (error) {
    console.error("[loadMoreSearchProductsAction] failed", error);
    return EMPTY_RESULT;
  }
}
