"use server";

import { z } from "zod";
import { getHomeNewArrivals, NEW_ARRIVAL_PAGE_SIZE, type StorefrontProductPage } from "@/lib/storefront-home";

const MAX_PAGE = 500;

const NewArrivalsInputSchema = z.object({
  page: z.number().int().min(1).max(MAX_PAGE),
});

const EMPTY_RESULT: StorefrontProductPage = {
  products: [],
  total: 0,
  page: 1,
  pageSize: NEW_ARRIVAL_PAGE_SIZE,
};

/**
 * Public read-only pagination for the home2 "สินค้ามาใหม่" list.
 *
 * Mirrors loadMoreCategoryProductsAction on /products: Zod-validated input, no
 * session needed (nothing is mutated), and failures degrade to an empty page
 * rather than surfacing a DB error to the browser.
 */
export async function loadMoreHomeNewArrivalsAction(
  input: z.infer<typeof NewArrivalsInputSchema>,
): Promise<StorefrontProductPage> {
  const parsed = NewArrivalsInputSchema.safeParse(input);
  if (!parsed.success) return EMPTY_RESULT;

  try {
    return await getHomeNewArrivals(parsed.data.page);
  } catch (error) {
    console.error("[loadMoreHomeNewArrivalsAction] failed", error);
    return EMPTY_RESULT;
  }
}
