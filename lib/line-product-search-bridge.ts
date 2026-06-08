import { LineIntent } from "@/lib/generated/prisma";
import type { LineIntentRouteResult } from "@/lib/line-intent-router";

type ProductSearchInput = {
  query?: string | null;
  isActive?: boolean;
  carBrandName?: string | null;
  carModelName?: string | null;
  fitmentYear?: number | null;
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
  fitmentHints?: {
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
  name: string;
  code: string | null;
};

/**
 * Fetches lightweight summaries (name + code) for matched product ids, preserving
 * the search rank order. Names come straight from the catalog — never fabricated —
 * so the reply can show the customer what was actually found.
 */
export async function getLineProductSummaries(ids: string[]): Promise<LineMatchedProductSummary[]> {
  if (ids.length === 0) return [];
  const { db } = await import("@/lib/db");
  const rows = await db.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, code: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => ({ name: row.name, code: row.code }));
}

function normalizeSearchSeed(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function buildSearchQuery(input: LineProductSearchBridgeInput) {
  const seeds = [
    normalizeSearchSeed(input.extractedPartNumber),
    normalizeSearchSeed(input.text),
    ...(input.extractedImageHints ?? []).map((hint) => normalizeSearchSeed(hint)),
  ].filter((seed): seed is string => Boolean(seed));

  return seeds[0] ?? null;
}

export async function searchLineProductInquiry(
  input: LineProductSearchBridgeInput,
  searchFn?: ProductSearchFn,
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

  const resolvedSearchFn =
    searchFn ??
    (async (searchInput: ProductSearchInput) => {
      const { searchProductIds } = await import("@/lib/product-search");
      return searchProductIds(searchInput);
    });

  const result = await resolvedSearchFn({
    query,
    isActive: true,
    carBrandName: input.fitmentHints?.carBrandName ?? null,
    carModelName: input.fitmentHints?.carModelName ?? null,
    fitmentYear: input.fitmentHints?.fitmentYear ?? null,
    skip: 0,
    take: input.take ?? 5,
    cacheProfile: "admin",
  });

  return {
    searched: true,
    reason: "SEARCHED_PRODUCT_INQUIRY",
    query,
    result,
    needsMoreInfo: result.total === 0 || result.ids.length === 0,
  };
}
