"use server";

import { z } from "zod";
import { getHome2NewArrivals, NEW_ARRIVAL_PAGE_SIZE, type Home2ProductPage } from "./home2-data";

const MAX_PAGE = 500;

const NewArrivalsInputSchema = z.object({
  page: z.number().int().min(1).max(MAX_PAGE),
});

const EMPTY_RESULT: Home2ProductPage = {
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
export async function loadMoreHome2NewArrivalsAction(
  input: z.infer<typeof NewArrivalsInputSchema>,
): Promise<Home2ProductPage> {
  const parsed = NewArrivalsInputSchema.safeParse(input);
  if (!parsed.success) return EMPTY_RESULT;

  try {
    return await getHome2NewArrivals(parsed.data.page);
  } catch (error) {
    console.error("[loadMoreHome2NewArrivalsAction] failed", error);
    return EMPTY_RESULT;
  }
}
