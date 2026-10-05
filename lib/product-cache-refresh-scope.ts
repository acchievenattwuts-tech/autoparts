/**
 * How far a product-master save has to reach into caches, decided from the fields
 * that actually changed (the top-level keys of the audit snapshot diff).
 *
 * Every product save still refreshes the cheap, product-scoped caches: admin product
 * search and the product's own storefront entry (`storefront-product:<id>` + its
 * canonical path, which the storefront sync audit relies on). Only the expensive
 * steps are scoped:
 *
 *  - storefront-wide invalidation — the shared `storefront:*` tags plus `/`,
 *    `/products` and `/sitemap.xml` — which makes every cached storefront page re-read
 *    the database on its next hit;
 *  - the search-keyword index rebuild (~0.3 MB of reads plus ~3.5k upserts per run);
 *  - the transaction product-picker catalog (~2.4 MB of reads on the next picker open).
 *
 * On 2026-10-03 a price-list session of 65 saves ran both steps 65 times, although the
 * storefront shows only `retailPrice` and the keyword index reads no price at all.
 *
 * Fail-safe: an unknown change set (`null`) refreshes everything, and a field missing
 * from both lists below counts as storefront-visible.
 */

/**
 * Product audit-snapshot fields that no storefront-tagged cache reads: admin prices,
 * reorder/shelf data, purchasing defaults, units and lot policy. Admin-side caches that
 * do read them (product search, transaction pickers) are refreshed on every save.
 * Adding a field here requires that no storefront loader selects it — enforced by
 * lib/__tests__/product-cache-refresh-scope.golden.test.ts.
 */
export const STOREFRONT_HIDDEN_PRODUCT_FIELDS: ReadonlySet<string> = new Set([
  "costPrice",
  "salePrice",
  "memberPrice",
  "priceListPrices",
  "minStock",
  "shelfLocation",
  "preferredSupplierId",
  "purchaseUnitName",
  "reportUnitName",
  "units",
  "isLotControl",
  "requireExpiryDate",
  "allowExpiredIssue",
  "lotIssueMethod",
]);

/**
 * Product columns that `buildSearchKeywordRows()` (lib/search-keyword-index.ts) reads,
 * in its `where` and `select`. Must match that query exactly — enforced by the golden test.
 */
export const SEARCH_KEYWORD_PRODUCT_FIELDS = ["isActive", "isStorefrontVisible", "name", "stock"] as const;

/**
 * Snapshot fields held by the transaction product-picker catalog,
 * `buildTransactionProductCatalog()` in lib/transaction-product-search.ts — its
 * searchable text only (category/brand by id). Prices, units and cost are read live
 * for the picked products, so price edits never need to rebuild it. Must match that
 * loader — enforced by the golden test.
 */
export const TRANSACTION_CATALOG_PRODUCT_FIELDS = [
  "aliases",
  "brandId",
  "categoryId",
  "code",
  "description",
  "isActive",
  "name",
] as const;

export type ProductCacheRefreshScope = {
  /** Expire the shared storefront tags and the home / listing / sitemap paths. */
  storefrontWide: boolean;
  /** Rebuild the autocomplete keyword index. */
  searchKeywordIndex: boolean;
  /** Expire the cached transaction product-picker catalog. */
  transactionProductCatalog: boolean;
};

export const FULL_PRODUCT_CACHE_REFRESH: ProductCacheRefreshScope = {
  storefrontWide: true,
  searchKeywordIndex: true,
  transactionProductCatalog: true,
};

const SEARCH_KEYWORD_PRODUCT_FIELD_SET: ReadonlySet<string> = new Set(SEARCH_KEYWORD_PRODUCT_FIELDS);
const TRANSACTION_CATALOG_PRODUCT_FIELD_SET: ReadonlySet<string> = new Set(TRANSACTION_CATALOG_PRODUCT_FIELDS);

export const resolveProductCacheRefreshScope = (
  changedFields: readonly string[] | null,
): ProductCacheRefreshScope => {
  if (changedFields === null) return FULL_PRODUCT_CACHE_REFRESH;
  return {
    storefrontWide: changedFields.some((field) => !STOREFRONT_HIDDEN_PRODUCT_FIELDS.has(field)),
    searchKeywordIndex: changedFields.some((field) => SEARCH_KEYWORD_PRODUCT_FIELD_SET.has(field)),
    transactionProductCatalog: changedFields.some((field) => TRANSACTION_CATALOG_PRODUCT_FIELD_SET.has(field)),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Top-level keys that differ in a `diffEntity()` result of two product snapshots.
 * Returns null when the diff is not an object diff, which callers treat as "unknown".
 */
export const listChangedSnapshotFields = (diff: { before: unknown; after: unknown }): string[] | null => {
  if (!isRecord(diff.before) || !isRecord(diff.after)) return null;
  return [...new Set([...Object.keys(diff.before), ...Object.keys(diff.after)])].sort();
};
