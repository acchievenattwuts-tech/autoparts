import { LineIntent } from "@/lib/generated/prisma";
import type { LineIntentRouteResult } from "@/lib/line-intent-router";
import { extractLineRequiredSearchTokens } from "@/lib/line-search-guards";

type ProductSearchInput = {
  query?: string | null;
  isActive?: boolean;
  categoryName?: string | null;
  carBrandName?: string | null;
  carModelName?: string | null;
  fitmentYear?: number | null;
  requiredTokens?: string[] | null;
  skip?: number;
  take?: number;
  cacheProfile?: "admin" | "storefront";
};
type ProductSearchOutput = {
  ids: string[];
  total: number;
  mode: "v2" | "fallback";
  matchReasons?: Record<string, string[]>;
};
type ProductSearchFn = (input: ProductSearchInput) => Promise<ProductSearchOutput>;

export type LineProductSearchBridgeInput = {
  route: LineIntentRouteResult;
  text?: string | null;
  extractedPartNumber?: string | null;
  extractedImageHints?: string[] | null;
  /** Car/brand/year terms carried over from earlier turns (short-term memory). */
  contextHints?: string[] | null;
  fitmentHints?: {
    categoryName?: string | null;
    carBrandName?: string | null;
    carModelName?: string | null;
    fitmentYear?: number | null;
  } | null;
  take?: number;
};

export type LineProductSearchBridgeResult =
  | {
      searched: false;
      reason: string;
      query: null;
      result: null;
    }
  | {
      searched: true;
      reason: string;
      query: string;
      result: ProductSearchOutput;
      needsMoreInfo: boolean;
    };

export type LineMatchedProductSummary = {
  id: string;
  name: string;
  code: string | null;
  imageUrl: string | null;
  salePrice: number;
};

/**
 * Fetches summaries (id, name, code, image, price) for matched product ids,
 * preserving the search rank order. Values come straight from the catalog — never
 * fabricated — so the reply can show the customer what was actually found and link
 * to the real storefront pages (the canonical product URL embeds the id).
 */
export async function getLineProductSummaries(ids: string[]): Promise<LineMatchedProductSummary[]> {
  if (ids.length === 0) return [];
  const { db } = await import("@/lib/db");
  const rows = await db.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, code: true, imageUrl: true, salePrice: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      imageUrl: row.imageUrl,
      salePrice: Number(row.salePrice),
    }));
}

const MAX_QUERY_LENGTH = 120;

function normalizeSearchSeed(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Builds the search query. An explicit part number wins outright (keep exact-code
 * matching precise). Otherwise combine the message text, vision hints, and carried-
 * over context terms into one query — token-deduped, order preserved, length capped
 * — which the V2 search ranks the same way the storefront handles full queries.
 */
function buildSearchQuery(input: LineProductSearchBridgeInput): string | null {
  const partNumber = normalizeSearchSeed(input.extractedPartNumber);
  if (partNumber) return partNumber.slice(0, MAX_QUERY_LENGTH);

  const sources = [
    input.text,
    ...(input.extractedImageHints ?? []),
    ...(input.contextHints ?? []),
  ];

  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const source of sources) {
    const normalized = normalizeSearchSeed(source);
    if (!normalized) continue;
    for (const token of normalized.split(/\s+/)) {
      const key = token.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      tokens.push(token);
    }
  }

  if (tokens.length === 0) return null;
  return tokens.join(" ").slice(0, MAX_QUERY_LENGTH).trim() || null;
}

type SuggestFn = (query: string) => Promise<string[]>;

export async function searchLineProductInquiry(
  input: LineProductSearchBridgeInput,
  searchFn?: ProductSearchFn,
  suggestFn?: SuggestFn,
): Promise<LineProductSearchBridgeResult> {
  const searchableIntent =
    input.route.intent === LineIntent.PRODUCT_INQUIRY_TEXT ||
    input.route.intent === LineIntent.PART_IMAGE_INQUIRY;

  if (!input.route.allowsSearch || !searchableIntent) {
    return {
      searched: false,
      reason: `NON_SEARCHABLE_INTENT_${input.route.intent}`,
      query: null,
      result: null,
    };
  }

  const query = buildSearchQuery(input);
  if (!query) {
    return {
      searched: false,
      reason: "NO_SEARCH_QUERY",
      query: null,
      result: null,
    };
  }
  const requiredTokens = extractLineRequiredSearchTokens(query);

  const resolvedSearchFn =
    searchFn ??
    (async (searchInput: ProductSearchInput) => {
      const { searchProductIds } = await import("@/lib/product-search");
      return searchProductIds(searchInput);
    });

  const result = await resolvedSearchFn({
    query,
    isActive: true,
    categoryName: input.fitmentHints?.categoryName ?? null,
    carBrandName: input.fitmentHints?.carBrandName ?? null,
    carModelName: input.fitmentHints?.carModelName ?? null,
    fitmentYear: input.fitmentHints?.fitmentYear ?? null,
    ...(requiredTokens.length > 0 ? { requiredTokens } : {}),
    skip: 0,
    take: input.take ?? 5,
    cacheProfile: "admin",
  });

  // No hits → try a "did you mean" spelling/synonym correction and re-search once.
  if (result.total === 0) {
    const resolvedSuggestFn =
      suggestFn ??
      (async (rawQuery: string) => {
        const { suggestDidYouMean } = await import("@/lib/product-search");
        return suggestDidYouMean(rawQuery);
      });

    const suggestions = await resolvedSuggestFn(query).catch(() => []);
    for (const suggestion of suggestions) {
      const normalizedSuggestion = normalizeSearchSeed(suggestion);
      if (!normalizedSuggestion || normalizedSuggestion.toLowerCase() === query.toLowerCase()) continue;

      const retry = await resolvedSearchFn({
        query: normalizedSuggestion,
        isActive: true,
        ...(requiredTokens.length > 0 ? { requiredTokens } : {}),
        skip: 0,
        take: input.take ?? 5,
        cacheProfile: "admin",
      });

      if (retry.total > 0) {
        return {
          searched: true,
          reason: `DID_YOU_MEAN:${normalizedSuggestion}`,
          query: normalizedSuggestion,
          result: retry,
          needsMoreInfo: false,
        };
      }
    }
  }

  return {
    searched: true,
    reason: "SEARCHED_PRODUCT_INQUIRY",
    query,
    result,
    needsMoreInfo: result.total === 0 || result.ids.length === 0,
  };
}
