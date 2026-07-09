import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma";
import {
  PRODUCT_SEARCH_TAG,
  STOREFRONT_PRODUCT_SEARCH_CACHE_TTL_SECONDS,
} from "@/lib/product-search-cache";
import {
  searchProductIds,
  sortProductsByIds,
  suggestDidYouMean,
} from "@/lib/product-search";
import { extractProductSearchRequiredTokens } from "@/lib/product-search-required-tokens";
import { segmentThaiQueryTokens } from "@/lib/thai-segment";
import { resolveStorefrontSearchIntent } from "@/lib/storefront-search-intent";

export const STOREFRONT_PRODUCTS_PER_PAGE = 24;

const PRODUCT_SELECT = {
  id: true,
  slug: true,
  name: true,
  code: true,
  imageUrl: true,
  salePrice: true,
  saleUnitName: true,
  warrantyDays: true,
  stock: true,
  category: { select: { name: true, slug: true } },
  brand: { select: { name: true } },
  carModels: {
    where: { fitmentType: "DIRECT" },
    select: {
      yearStart: true,
      yearEnd: true,
      carModel: {
        select: {
          name: true,
          carBrand: { select: { name: true } },
        },
      },
    },
    take: 6,
  },
} as const;

export type SearchProductItem = {
  id: string;
  slug: string | null;
  name: string;
  code: string;
  imageUrl: string | null;
  salePrice: string;
  saleUnitName: string | null;
  warrantyDays: number;
  stock: number;
  category: { name: string; slug: string | null };
  brand: { name: string } | null;
  carModels: Array<{
    yearStart: number | null;
    yearEnd: number | null;
    carModel: { name: string; carBrand: { name: string } };
  }>;
};

export type StorefrontProductSearchInput = {
  q?: string;
  category?: string;
  brand?: string;
  models?: string[];
  year?: number | null;
  page?: number;
  /** Multi-select filters (Filter UI v2) */
  categories?: string[];
  partsBrands?: string[];
  carBrands?: string[];
  yearMin?: number | null;
  yearMax?: number | null;
  priceMin?: number | null;
  priceMax?: number | null;
};

export type SearchProductsResult = {
  products: SearchProductItem[];
  total: number;
  didYouMean: string[];
  page: number;
  totalPages: number;
  pageStart: number;
  pageEnd: number;
  requiredTokenFallback?: {
    requiredTokens: string[];
    usedFallback: boolean;
  };
};

type SearchProductRecord = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;

type NormalizedStorefrontProductSearchInput = {
  q?: string;
  category?: string;
  brand?: string;
  models: string[];
  year: number | null;
  page: number;
  categories: string[];
  partsBrands: string[];
  carBrands: string[];
  yearMin: number | null;
  yearMax: number | null;
  priceMin: number | null;
  priceMax: number | null;
};

const normalizeTextInput = (value?: string): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

const normalizeModelsInput = (models?: string[]): string[] =>
  Array.from(new Set((models ?? []).map((value) => value.trim()).filter(Boolean)));

const normalizeYearInput = (year?: number | null): number | null => {
  if (typeof year !== "number" || !Number.isFinite(year)) return null;
  if (year < 1900 || year > 2200) return null;
  return Math.trunc(year);
};

const normalizePriceInput = (value?: number | null): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
};

const normalizePageInput = (page?: number): number => {
  if (typeof page !== "number" || !Number.isFinite(page) || page < 1) return 1;
  return Math.trunc(page);
};

const normalizeSearchInput = (
  input: StorefrontProductSearchInput,
): NormalizedStorefrontProductSearchInput => ({
  q: normalizeTextInput(input.q),
  category: normalizeTextInput(input.category),
  brand: normalizeTextInput(input.brand),
  models: normalizeModelsInput(input.models),
  year: normalizeYearInput(input.year),
  page: normalizePageInput(input.page),
  categories: normalizeModelsInput(input.categories),
  partsBrands: normalizeModelsInput(input.partsBrands),
  carBrands: normalizeModelsInput(input.carBrands),
  yearMin: normalizeYearInput(input.yearMin),
  yearMax: normalizeYearInput(input.yearMax),
  priceMin: normalizePriceInput(input.priceMin),
  priceMax: normalizePriceInput(input.priceMax),
});

const serializeSearchProduct = (product: SearchProductRecord): SearchProductItem => ({
  id: product.id,
  slug: product.slug,
  name: product.name,
  code: product.code,
  imageUrl: product.imageUrl,
  salePrice: product.salePrice.toString(),
  saleUnitName: product.saleUnitName,
  warrantyDays: product.warrantyDays,
  stock: product.stock,
  category: product.category,
  brand: product.brand,
  carModels: product.carModels,
});

type StorefrontSearchProductIds = typeof searchProductIds;
type StorefrontSearchInput = Parameters<StorefrontSearchProductIds>[0];
type StorefrontSearchResult = Awaited<ReturnType<StorefrontSearchProductIds>>;

export async function runStorefrontProductSearchWithRequiredTokenFallback(
  input: StorefrontSearchInput,
  searchProductIdsFn: StorefrontSearchProductIds = searchProductIds,
): Promise<{
  searchResult: StorefrontSearchResult;
  requiredTokenFallback?: {
    requiredTokens: string[];
    usedFallback: boolean;
  };
}> {
  // Recall anchors = digit/code fragments (existing) PLUS Thai words from
  // dictionary segmentation (Phase A-light). Both flow through the same
  // LIKE-contains AND clause; the strict→fallback below guarantees no regression
  // if the tighter AND yields nothing.
  //
  // Thai words are only added when segmentation yields ≥2 of them — i.e. a glued
  // multi-word compound ("น้ำยาล้างคอยเย็น"), the exact case AND-precision should
  // engage. A single dictionary word gains nothing from this and is skipped so
  // synonym/fuzzy recall for plain one-word Thai queries is left untouched.
  const segmentedThaiTokens = segmentThaiQueryTokens(input.query);
  const requiredTokens = Array.from(
    new Set([
      ...extractProductSearchRequiredTokens(input.query),
      ...(segmentedThaiTokens.length >= 2 ? segmentedThaiTokens : []),
    ]),
  );
  if (requiredTokens.length === 0) {
    return { searchResult: await searchProductIdsFn(input) };
  }

  const strictResult = await searchProductIdsFn({
    ...input,
    requiredTokens,
  });
  if (strictResult.total > 0) {
    return {
      searchResult: strictResult,
      requiredTokenFallback: { requiredTokens, usedFallback: false },
    };
  }

  const fallbackResult = await searchProductIdsFn(input);
  return {
    searchResult: fallbackResult,
    requiredTokenFallback: { requiredTokens, usedFallback: true },
  };
}

const getCachedStorefrontProductSearchPageData = unstable_cache(
  async (
    input: NormalizedStorefrontProductSearchInput,
  ): Promise<SearchProductsResult> => {
    const skip = (input.page - 1) * STOREFRONT_PRODUCTS_PER_PAGE;
    const { searchResult, requiredTokenFallback } =
      await runStorefrontProductSearchWithRequiredTokenFallback({
      query: input.q,
      isActive: true,
      isStorefrontVisible: true,
      categoryName: input.category,
      carBrandName: input.brand,
      carModelNames: input.models,
      fitmentYear: input.year,
      categoryNames: input.categories,
      brandIds: input.partsBrands,
      carBrandNames: input.carBrands,
      yearMin: input.yearMin,
      yearMax: input.yearMax,
      priceMin: input.priceMin,
      priceMax: input.priceMax,
      skip,
      take: STOREFRONT_PRODUCTS_PER_PAGE,
      order: "createdAtDesc",
      cacheProfile: "storefront",
    });

    const products = await db.product.findMany({
      where: {
        isActive: true,
        isStorefrontVisible: true,
        id: {
          in: searchResult.ids.length > 0 ? searchResult.ids : ["__no-results__"],
        },
      },
      select: PRODUCT_SELECT,
    });

    const serializedProducts = sortProductsByIds(products, searchResult.ids).map(
      serializeSearchProduct,
    );
    const didYouMean =
      input.q && searchResult.total < 3 ? await suggestDidYouMean(input.q, 3) : [];
    const totalPages = Math.max(
      1,
      Math.ceil(searchResult.total / STOREFRONT_PRODUCTS_PER_PAGE),
    );
    const pageStart = searchResult.total === 0 ? 0 : skip + 1;
    const pageEnd = Math.min(skip + serializedProducts.length, searchResult.total);

    return {
      products: serializedProducts,
      total: searchResult.total,
      didYouMean,
      page: input.page,
      totalPages,
      pageStart,
      pageEnd,
      ...(requiredTokenFallback ? { requiredTokenFallback } : {}),
    };
  },
  ["storefront-product-search-page-data"],
  {
    tags: ["storefront:products", PRODUCT_SEARCH_TAG],
    revalidate: STOREFRONT_PRODUCT_SEARCH_CACHE_TTL_SECONDS,
  },
);

/**
 * Applies the shared LINE-grade precision pipeline to a free-text query: detects
 * the category / car brand / model / year the customer actually meant and pins
 * them as hard filters, so results stay on-topic instead of broad. Only runs when
 * there IS a query and the user has NOT already chosen explicit fitment filters
 * (an explicit selection always wins). Returns the enriched input plus whether the
 * year filter came from the intent (so it can be dropped on a zero-result retry).
 */
async function enrichInputWithSearchIntent(
  input: StorefrontProductSearchInput,
): Promise<{ input: StorefrontProductSearchInput; intentYearApplied: boolean }> {
  const query = input.q?.trim();
  if (!query) return { input, intentYearApplied: false };

  // Respect an explicit user selection — never override chosen filters.
  const hasExplicitFitment =
    Boolean(input.category) ||
    Boolean(input.brand) ||
    (input.models?.length ?? 0) > 0 ||
    (input.categories?.length ?? 0) > 0 ||
    (input.carBrands?.length ?? 0) > 0 ||
    typeof input.year === "number" ||
    typeof input.yearMin === "number" ||
    typeof input.yearMax === "number";
  if (hasExplicitFitment) return { input, intentYearApplied: false };

  const resolved = await resolveStorefrontSearchIntent(query).catch(() => null);
  if (!resolved) return { input, intentYearApplied: false };

  const enriched: StorefrontProductSearchInput = {
    ...input,
    q: resolved.query || query,
    category: resolved.categoryName ?? input.category,
    brand: resolved.carBrandName ?? input.brand,
    models: resolved.carModelName ? [resolved.carModelName] : input.models,
    year: resolved.fitmentYear ?? input.year ?? null,
  };
  return { input: enriched, intentYearApplied: resolved.fitmentYear !== null };
}

export async function getStorefrontProductSearchPageData(
  input: StorefrontProductSearchInput,
): Promise<SearchProductsResult> {
  const { input: enriched, intentYearApplied } = await enrichInputWithSearchIntent(input);

  const result = await getCachedStorefrontProductSearchPageData(normalizeSearchInput(enriched));

  // LINE-style recovery: an intent-detected year is a hard filter that can zero an
  // otherwise valid search (the customer's shorthand year may not match the stored
  // fitment range). When that happens, retry once without the year before giving up.
  if (result.total === 0 && intentYearApplied) {
    const retry = await getCachedStorefrontProductSearchPageData(
      normalizeSearchInput({ ...enriched, year: null }),
    );
    if (retry.total > 0) return retry;
  }

  return result;
}
