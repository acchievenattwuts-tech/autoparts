"use server";

import { z } from "zod";
import { getRelatedStorefrontProductsPaginated } from "@/lib/storefront-product";

const LOAD_MORE_TAKE = 8;

const LoadMoreSchema = z.object({
  categoryId: z.string().min(1),
  currentProductId: z.string().min(1),
  skip: z.number().int().min(0).max(500),
});

type RawRelatedProduct = Awaited<
  ReturnType<typeof getRelatedStorefrontProductsPaginated>
>[number];

// salePrice/retailPrice serialized to string for safe Server→Client boundary transfer
export type RelatedProduct = Omit<RawRelatedProduct, "salePrice" | "retailPrice"> & {
  salePrice: string;
  retailPrice: string;
};

export async function loadMoreRelatedProducts(
  input: z.infer<typeof LoadMoreSchema>,
): Promise<{ products: RelatedProduct[]; hasMore: boolean }> {
  const parsed = LoadMoreSchema.safeParse(input);
  if (!parsed.success) return { products: [], hasMore: false };

  const { categoryId, currentProductId, skip } = parsed.data;

  const rows = await getRelatedStorefrontProductsPaginated({
    categoryId,
    currentProductId,
    skip,
    take: LOAD_MORE_TAKE + 1,
  });

  const hasMore = rows.length > LOAD_MORE_TAKE;
  const products: RelatedProduct[] = rows
    .slice(0, LOAD_MORE_TAKE)
    .map((p) => ({
      ...p,
      salePrice: p.salePrice.toString(),
      retailPrice: p.retailPrice.toString(),
    }));

  return { products, hasMore };
}
