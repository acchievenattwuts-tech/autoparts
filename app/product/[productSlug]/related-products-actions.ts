"use server";

import { z } from "zod";
import { getRelatedStorefrontProductsPaginated } from "@/lib/storefront-product";
import {
  toStorefrontProductCardItem,
  type StorefrontProductCardItem,
} from "@/lib/storefront-product-card";
import {
  STOREFRONT_ID_MAX_LENGTH,
  allowStorefrontLoadMore,
} from "@/lib/storefront-load-more-guard";

const LOAD_MORE_TAKE = 8;

const LoadMoreSchema = z.object({
  categoryId: z.string().min(1).max(STOREFRONT_ID_MAX_LENGTH),
  currentProductId: z.string().min(1).max(STOREFRONT_ID_MAX_LENGTH),
  skip: z.number().int().min(0).max(500),
});

// Public card payload only: retail price as a string, stock reduced to in/out.
export type RelatedProduct = StorefrontProductCardItem<{ id: string; name: string; slug: string | null }>;

export type LoadMoreRelatedProductsResult = {
  products: RelatedProduct[];
  hasMore: boolean;
  /**
   * True when nothing was loaded because the request was throttled or the
   * database call failed — the UI keeps its "load more" button so the customer
   * can retry, instead of treating it as the end of the list.
   */
  failed?: boolean;
};

const FAILED_RESULT: LoadMoreRelatedProductsResult = {
  products: [],
  hasMore: true,
  failed: true,
};

export async function loadMoreRelatedProducts(
  input: z.infer<typeof LoadMoreSchema>,
): Promise<LoadMoreRelatedProductsResult> {
  const parsed = LoadMoreSchema.safeParse(input);
  if (!parsed.success) return { products: [], hasMore: false };
  if (!(await allowStorefrontLoadMore("loadMoreRelatedProducts"))) return FAILED_RESULT;

  const { categoryId, currentProductId, skip } = parsed.data;

  try {
    const rows = await getRelatedStorefrontProductsPaginated({
      categoryId,
      currentProductId,
      skip,
      take: LOAD_MORE_TAKE + 1,
    });

    const hasMore = rows.length > LOAD_MORE_TAKE;
    const products: RelatedProduct[] = rows
      .slice(0, LOAD_MORE_TAKE)
      .map(toStorefrontProductCardItem);

    return { products, hasMore };
  } catch (error) {
    // Previously uncaught: a DB error here reached the page's error boundary and
    // replaced the whole product page with the error screen.
    console.error("[loadMoreRelatedProducts] failed", error);
    return FAILED_RESULT;
  }
}
