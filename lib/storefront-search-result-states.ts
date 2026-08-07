import type { SearchProductsResult } from "@/lib/storefront-product-search";

/**
 * The two "no products" payloads storefront search can return, kept apart on
 * purpose.
 *
 * `EMPTY_SEARCH_RESULT` means the search ran and matched nothing.
 * `RATE_LIMITED_SEARCH_RESULT` means it never ran at all.
 *
 * They carry identical product data, so nothing but the `rateLimited` flag
 * tells them apart — and rendering the throttled one as "ไม่พบสินค้าที่ค้นหา"
 * would tell a customer we do not stock the part when we simply declined to
 * look. They live here (rather than in the "use server" action module, whose
 * every export must be an async function) so the distinction can be tested.
 */

export const EMPTY_SEARCH_RESULT: SearchProductsResult = {
  products: [],
  total: 0,
  didYouMean: [],
  page: 1,
  totalPages: 1,
  pageStart: 0,
  pageEnd: 0,
};

export const RATE_LIMITED_SEARCH_RESULT: SearchProductsResult = {
  ...EMPTY_SEARCH_RESULT,
  rateLimited: true,
};

/**
 * Whether the UI may replace the results it is showing with this payload.
 * False only for a throttled response, where the previous results are still the
 * best information we have.
 */
export const shouldReplaceShownResults = (result: SearchProductsResult): boolean =>
  result.rateLimited !== true;
