"use server";

import { z } from "zod";
import {
  getStorefrontCategoryProductPageById,
  type StorefrontCategoryProductItem,
} from "@/lib/storefront-category";
import {
  STOREFRONT_ID_MAX_LENGTH,
  allowStorefrontLoadMore,
} from "@/lib/storefront-load-more-guard";

const CategoryProductsInputSchema = z.object({
  categoryId: z.string().min(1).max(STOREFRONT_ID_MAX_LENGTH),
  page: z.number().int().min(1).max(500),
});

type CategoryProductsPage = {
  products: StorefrontCategoryProductItem[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * `ok: false` means nothing was loaded (invalid input, throttled, or the
 * database call failed). It used to come back as an empty page with total 0,
 * which the grid could not tell apart from a real result — it showed
 * "แสดง 1-20 จาก 0 รายการ" and dropped the load-more control for good.
 */
export type LoadMoreCategoryProductsResult =
  | ({ ok: true } & CategoryProductsPage)
  | { ok: false };

const NOT_LOADED: LoadMoreCategoryProductsResult = { ok: false };

export async function loadMoreCategoryProductsAction(
  input: z.infer<typeof CategoryProductsInputSchema>,
): Promise<LoadMoreCategoryProductsResult> {
  const parsed = CategoryProductsInputSchema.safeParse(input);
  if (!parsed.success) return NOT_LOADED;
  if (!(await allowStorefrontLoadMore("loadMoreCategoryProductsAction"))) return NOT_LOADED;

  try {
    const page = await getStorefrontCategoryProductPageById(
      parsed.data.categoryId,
      parsed.data.page,
    );
    return { ok: true, ...page };
  } catch (error) {
    console.error("[loadMoreCategoryProductsAction] failed", error);
    return NOT_LOADED;
  }
}
