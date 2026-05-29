import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma";
import {
  searchProductIds,
  sortProductsByIds,
  suggestDidYouMean,
} from "@/lib/product-search";

export const STOREFRONT_PRODUCTS_PER_PAGE = 24;

const PRODUCT_SELECT = {
  id: true,
  slug: true,
  name: true,
  code: true,
  imageUrl: true,
  salePrice: true,
  stock: true,
  reportUnitName: true,
  category: { select: { name: true, slug: true } },
  brand: { select: { name: true } },
  carModels: {
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
  stock: number;
  reportUnitName: string;
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
};

export type SearchProductsResult = {
  products: SearchProductItem[];
  total: number;
  didYouMean: string[];
  page: number;
  totalPages: number;
  pageStart: number;
  pageEnd: number;
};

type SearchProductRecord = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;

type NormalizedStorefrontProductSearchInput = {
  q?: string;
  category?: string;
  brand?: string;
  models: string[];
  year: number | null;
  page: number;
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
});

const serializeSearchProduct = (product: SearchProductRecord): SearchProductItem => ({
  id: product.id,
  slug: product.slug,
  name: product.name,
  code: product.code,
  imageUrl: product.imageUrl,
  salePrice: product.salePrice.toString(),
  stock: product.stock,
  reportUnitName: product.reportUnitName,
  category: product.category,
  brand: product.brand,
  carModels: product.carModels,
});

const getCachedStorefrontProductSearchPageData = unstable_cache(
  async (
    input: NormalizedStorefrontProductSearchInput,
  ): Promise<SearchProductsResult> => {
    const skip = (input.page - 1) * STOREFRONT_PRODUCTS_PER_PAGE;
    const searchResult = await searchProductIds({
      query: input.q,
      isActive: true,
      categoryName: input.category,
      carBrandName: input.brand,
      carModelNames: input.models,
      fitmentYear: input.year,
      skip,
      take: STOREFRONT_PRODUCTS_PER_PAGE,
      order: "createdAtDesc",
    });

    const products = await db.product.findMany({
      where: {
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
    };
  },
  ["storefront-product-search-page-data"],
  { tags: ["storefront:products", "product-search"], revalidate: 300 },
);

export async function getStorefrontProductSearchPageData(
  input: StorefrontProductSearchInput,
): Promise<SearchProductsResult> {
  return getCachedStorefrontProductSearchPageData(normalizeSearchInput(input));
}
