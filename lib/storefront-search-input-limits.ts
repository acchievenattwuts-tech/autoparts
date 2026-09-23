/**
 * Input ceilings for the storefront product search, shared by both entry points
 * into the same search engine:
 *
 * - `searchProductsAction` / `loadMoreSearchProductsAction` (POST) validate with
 *   Zod and reject anything over these limits;
 * - `GET /products` reads raw query params, so it CLAMPS to the same limits
 *   instead of rejecting — a hand-edited or bot URL still renders a page, it
 *   just cannot push an unbounded query, value list, or OFFSET into Postgres.
 *
 * Every limit is far beyond what the storefront UI can produce, so a real
 * customer's search is never altered.
 */
export const STOREFRONT_SEARCH_MAX_QUERY_LENGTH = 200;
export const STOREFRONT_SEARCH_MAX_NAME_LENGTH = 200;
export const STOREFRONT_SEARCH_MAX_ID_LENGTH = 64;
export const STOREFRONT_SEARCH_MAX_LIST_ITEMS = 50;
export const STOREFRONT_SEARCH_MAX_PAGE = 500;
export const STOREFRONT_SEARCH_MAX_PRICE = 99_999_999;

/** Trim a free-text param to `maxLength` characters; `undefined` stays `undefined`. */
export const clampSearchText = (
  value: string | undefined,
  maxLength: number = STOREFRONT_SEARCH_MAX_NAME_LENGTH,
): string | undefined => (value === undefined ? undefined : value.slice(0, maxLength));

/** Keep at most `STOREFRONT_SEARCH_MAX_LIST_ITEMS` values, each trimmed to `maxLength`. */
export const clampSearchList = (
  values: string[],
  maxLength: number = STOREFRONT_SEARCH_MAX_NAME_LENGTH,
): string[] =>
  values.slice(0, STOREFRONT_SEARCH_MAX_LIST_ITEMS).map((value) => value.slice(0, maxLength));

/** Cap a 1-based page number at `STOREFRONT_SEARCH_MAX_PAGE`. */
export const clampSearchPage = (page: number): number => Math.min(page, STOREFRONT_SEARCH_MAX_PAGE);

/** Cap a non-negative price filter at `STOREFRONT_SEARCH_MAX_PRICE`; `null` stays `null`. */
export const clampSearchPrice = (price: number | null): number | null =>
  price === null ? null : Math.min(price, STOREFRONT_SEARCH_MAX_PRICE);
