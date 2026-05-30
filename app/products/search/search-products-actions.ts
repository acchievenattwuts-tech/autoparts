"use server";

import { z } from "zod";
import {
  getStorefrontProductSearchPageData,
  STOREFRONT_PRODUCTS_PER_PAGE,
} from "@/lib/storefront-product-search";
import type { SearchProductsResult } from "@/lib/storefront-product-search";
import { logProductSearchTelemetry } from "@/lib/product-search-telemetry";

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

const EMPTY_RESULT: SearchProductsResult = {
  products: [],
  total: 0,
  didYouMean: [],
  page: 1,
  totalPages: 1,
  pageStart: 0,
  pageEnd: 0,
};

export async function searchProductsAction(
  input: SearchFilterInput,
): Promise<SearchProductsResult> {
  const parsed = SearchInputSchema.safeParse(input);
  if (!parsed.success) return EMPTY_RESULT;

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
  } as const;

  try {
    const result = await getStorefrontProductSearchPageData({
      q,
      category,
      brand,
      models,
      year: year ?? null,
      page,
      categories,
      partsBrands,
      carBrands,
      yearMin: yearMin ?? null,
      yearMax: yearMax ?? null,
      priceMin: priceMin ?? null,
      priceMax: priceMax ?? null,
    });

    await logProductSearchTelemetry({
      input: searchInput,
      resultCount: result.total,
      source: "storefront",
      path: "/products/search",
    });
    return result;
  } catch (error) {
    console.error("[searchProductsAction] failed", error);
    return EMPTY_RESULT;
  }
}
