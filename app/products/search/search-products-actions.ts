"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import {
  searchProductIds,
  sortProductsByIds,
  suggestDidYouMean,
} from "@/lib/product-search";
import { logProductSearchTelemetry } from "@/lib/product-search-telemetry";

const PRODUCTS_PER_PAGE = 24;

const SearchInputSchema = z.object({
  q: z.string().max(200).optional(),
  category: z.string().max(200).optional(),
  brand: z.string().max(200).optional(),
  models: z.array(z.string().max(200)).max(50).default([]),
  year: z.number().int().min(1900).max(2200).nullable().optional(),
  page: z.number().int().min(1).max(500).default(1),
});

export type SearchFilterInput = z.infer<typeof SearchInputSchema>;

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

export type SearchProductsResult = {
  products: SearchProductItem[];
  total: number;
  didYouMean: string[];
  page: number;
  totalPages: number;
  pageStart: number;
  pageEnd: number;
};

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

  const { q, category, brand, models, year, page } = parsed.data;
  const skip = (page - 1) * PRODUCTS_PER_PAGE;

  const searchInput = {
    query: q,
    isActive: true,
    categoryName: category,
    carBrandName: brand,
    carModelNames: models,
    fitmentYear: year ?? null,
    skip,
    take: PRODUCTS_PER_PAGE,
    order: "createdAtDesc",
  } as const;

  try {
    const searchResult = await searchProductIds(searchInput);

    await logProductSearchTelemetry({
      input: searchInput,
      resultCount: searchResult.total,
      source: "storefront",
      path: "/products/search",
    });

    const products = await db.product.findMany({
      where: {
        id: { in: searchResult.ids.length > 0 ? searchResult.ids : ["__no-results__"] },
      },
      select: PRODUCT_SELECT,
    });

    const sorted = sortProductsByIds(products, searchResult.ids);

    const serializedProducts: SearchProductItem[] = sorted.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      code: p.code,
      imageUrl: p.imageUrl,
      salePrice: p.salePrice.toString(),
      stock: p.stock,
      reportUnitName: p.reportUnitName,
      category: p.category,
      brand: p.brand,
      carModels: p.carModels,
    }));

    const didYouMean =
      q && searchResult.total < 3 ? await suggestDidYouMean(q, 3) : [];

    const totalPages = Math.max(
      1,
      Math.ceil(searchResult.total / PRODUCTS_PER_PAGE),
    );
    const pageStart = searchResult.total === 0 ? 0 : skip + 1;
    const pageEnd = Math.min(skip + serializedProducts.length, searchResult.total);

    return {
      products: serializedProducts,
      total: searchResult.total,
      didYouMean,
      page,
      totalPages,
      pageStart,
      pageEnd,
    };
  } catch (error) {
    console.error("[searchProductsAction] failed", error);
    return EMPTY_RESULT;
  }
}
