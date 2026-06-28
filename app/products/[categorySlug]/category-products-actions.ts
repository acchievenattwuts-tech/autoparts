"use server";

import { z } from "zod";
import {
  getStorefrontCategoryProductPageById,
  type StorefrontCategoryProductItem,
} from "@/lib/storefront-category";

const CategoryProductsInputSchema = z.object({
  categoryId: z.string().min(1),
  page: z.number().int().min(1).max(500),
});

type CategoryProductsResult = {
  products: StorefrontCategoryProductItem[];
  total: number;
  page: number;
  pageSize: number;
};

const EMPTY_RESULT: CategoryProductsResult = {
  products: [],
  total: 0,
  page: 1,
  pageSize: 20,
};

export async function loadMoreCategoryProductsAction(
  input: z.infer<typeof CategoryProductsInputSchema>,
): Promise<CategoryProductsResult> {
  const parsed = CategoryProductsInputSchema.safeParse(input);
  if (!parsed.success) return EMPTY_RESULT;

  try {
    return await getStorefrontCategoryProductPageById(
      parsed.data.categoryId,
      parsed.data.page,
    );
  } catch (error) {
    console.error("[loadMoreCategoryProductsAction] failed", error);
    return EMPTY_RESULT;
  }
}
