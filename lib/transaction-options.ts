import { unstable_cache, updateTag } from "next/cache";

import { db, withDbRetry } from "@/lib/db";
import type { InventoryTracking, LotIssueMethod, Prisma } from "@/lib/generated/prisma";
import { isInventoryTracked } from "@/lib/inventory-tracking";
import {
  compressJsonForCache,
  decompressJsonFromCache,
} from "@/lib/json-cache-compression";

const uniqueIds = (ids: Array<string | null | undefined>): string[] =>
  [...new Set(ids.filter((id): id is string => Boolean(id)))];

// Shared safety-net revalidate window for cached transaction dropdown options.
// Tag invalidation is the primary path (every product/customer/supplier mutation
// calls updateTag), so fresh data still arrives immediately; this window only
// bounds staleness if an invalidation is ever missed. Kept long (24h) because
// each full-catalog refetch pulls the whole product master + alias set from the
// database — a major Supabase egress cost when it ran every few minutes.
const TRANSACTION_OPTIONS_REVALIDATE_SECONDS = 86_400;

export const activeOrReferencedWhere = (
  referencedIds: Array<string | null | undefined> = [],
): Prisma.ProductWhereInput => {
  const ids = uniqueIds(referencedIds);
  return ids.length > 0
    ? { OR: [{ isActive: true }, { id: { in: ids } }] }
    : { isActive: true };
};

// Active-customer dropdown options. Cached because the customer master changes
// rarely relative to how often transaction forms open. Invalidated by
// invalidateTransactionCustomerOptions() from every customer mutation site
// (customers, sales inline create/update, delivery geo update).
export const TRANSACTION_CUSTOMER_OPTIONS_TAG = "admin-transaction:customer-options";

// Float lat/long + Int creditTerm + enum priceTier — all JSON-safe, no Decimal.
const CUSTOMER_OPTION_SELECT = {
  id: true,
  name: true,
  phone: true,
  code: true,
  shippingAddress: true,
  creditTerm: true,
  defaultLatitude: true,
  defaultLongitude: true,
  isActive: true,
  customerType: { select: { priceTier: true } },
} as const;

const loadActiveTransactionCustomers = async () =>
  withDbRetry(() =>
    db.customer.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: CUSTOMER_OPTION_SELECT,
    }),
  );

const getActiveTransactionCustomers = unstable_cache(
  loadActiveTransactionCustomers,
  ["admin-transaction-customer-options-v1"],
  {
    tags: [TRANSACTION_CUSTOMER_OPTIONS_TAG],
    revalidate: TRANSACTION_OPTIONS_REVALIDATE_SECONDS,
  },
);

/** Invalidate the cached active-customer option list after a customer mutation. */
export const invalidateTransactionCustomerOptions = (): void => {
  updateTag(TRANSACTION_CUSTOMER_OPTIONS_TAG);
};

export const getTransactionCustomers = (
  referencedIds: Array<string | null | undefined> = [],
) => {
  const ids = uniqueIds(referencedIds);
  if (ids.length === 0) {
    return getActiveTransactionCustomers();
  }
  // Edit flows may reference an inactive customer — read live so the referenced
  // record is always included (bypasses the active-only cache).
  return db.customer.findMany({
    where: { OR: [{ isActive: true }, { id: { in: ids } }] },
    orderBy: { name: "asc" },
    select: CUSTOMER_OPTION_SELECT,
  });
};

// Active-supplier dropdown options. Cached because the supplier master changes
// rarely but is read on every transaction form open. Invalidated by
// invalidateTransactionSupplierOptions() from master/suppliers/actions.ts.
export const TRANSACTION_SUPPLIER_OPTIONS_TAG = "admin-transaction:supplier-options";

const SUPPLIER_OPTION_SELECT = {
  id: true, name: true, code: true, phone: true, creditTerm: true, isActive: true,
} as const;

const loadActiveTransactionSuppliers = async () =>
  withDbRetry(() =>
    db.supplier.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: SUPPLIER_OPTION_SELECT,
    }),
  );

const getActiveTransactionSuppliers = unstable_cache(
  loadActiveTransactionSuppliers,
  ["admin-transaction-supplier-options-v1"],
  {
    tags: [TRANSACTION_SUPPLIER_OPTIONS_TAG],
    revalidate: TRANSACTION_OPTIONS_REVALIDATE_SECONDS,
  },
);

/** Invalidate the cached active-supplier option list after a supplier mutation. */
export const invalidateTransactionSupplierOptions = (): void => {
  updateTag(TRANSACTION_SUPPLIER_OPTIONS_TAG);
};

export const getTransactionSuppliers = (
  referencedIds: Array<string | null | undefined> = [],
) => {
  const ids = uniqueIds(referencedIds);
  if (ids.length === 0) {
    return getActiveTransactionSuppliers();
  }
  // Edit / linked-claim flows may reference an inactive supplier — read live so
  // the referenced record is always included (bypasses the active-only cache).
  return db.supplier.findMany({
    where: { OR: [{ isActive: true }, { id: { in: ids } }] },
    orderBy: { name: "asc" },
    select: SUPPLIER_OPTION_SELECT,
  });
};

// -----------------------------------------------------------------------------
// Product dropdown options for admin transaction forms (sales / purchases /
// purchase-returns / credit-notes).
//
// All four forms load the *entire* product master joined with category, brand,
// aliases, units, and preferred supplier, then filter it client-side inside
// <SearchableSelect>. That heavy join query was re-run on every page open. We
// cache one shared superset row set here and let each form map its own subset,
// so the results are byte-for-byte identical while the DB round-trip is skipped.
//
// Invalidation: product create/update/toggle calls updateTag(...) via
// revalidateStorefrontProductCaches() in products/actions.ts. A revalidate
// window is kept as a safety net (matching lib/admin-master-options.ts).
//
// Decimal fields are converted to Number before caching because Prisma Decimal
// objects do not round-trip through unstable_cache's JSON serialization.
//
// NOTE: avgCost is deliberately NOT cached — it moves on every stock-in
// (writeStockCard). purchase-returns merges a live avgCost lookup instead.
//
// The JSON form of this shared row set exceeds Next.js' 2 MiB Data Cache entry
// limit in production. Store it as async gzip/base64 and decode after the cache
// lookup. Forms still receive the exact same ProductOptionRow[] shape, while a
// warm request avoids repeating the heavy product/alias query.
// -----------------------------------------------------------------------------

export const TRANSACTION_PRODUCT_OPTIONS_TAG = "admin-transaction:product-options";

type ProductOptionRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  salePrice: number;
  retailPrice: number;
  costPrice: number;
  saleUnitName: string;
  purchaseUnitName: string;
  warrantyDays: number;
  inventoryTracking: InventoryTracking;
  isLotControl: boolean;
  lotIssueMethod: LotIssueMethod;
  allowExpiredIssue: boolean;
  requireExpiryDate: boolean;
  preferredSupplierId: string | null;
  preferredSupplierName: string | null;
  preferredSupplierActive: boolean;
  categoryName: string;
  brandName: string | null;
  aliasSearchText: string;
  units: { name: string; scale: number; isBase: boolean }[];
  isActive: boolean;
};

// Dropdown search matches on description via `.includes`, but descriptions
// average ~1.5k chars (≈1.3 MB per full-catalog fetch). Keeping the first 300
// chars preserves nearly all search value at a fraction of the egress.
const PRODUCT_OPTION_DESCRIPTION_MAX_CHARS = 300;

const truncateOptionDescription = (description: string | null): string | null =>
  description && description.length > PRODUCT_OPTION_DESCRIPTION_MAX_CHARS
    ? description.slice(0, PRODUCT_OPTION_DESCRIPTION_MAX_CHARS)
    : description;

/**
 * Pre-aggregated `aliasSearchText` per product, built in SQL. Produces the same
 * value as `buildProductAliasSearchText(aliases)` — lowercased, de-duplicated,
 * newline-joined — but returns one row per product instead of streaming all
 * ~36k alias rows to the app (the alias fetch dominated this loader's egress).
 * Only the internal line order differs, which `.includes()` matching never sees.
 */
const loadAliasSearchTextByProduct = async (): Promise<Map<string, string>> => {
  const rows = await withDbRetry(() =>
    db.$queryRaw<Array<{ productId: string; aliasSearchText: string | null }>>`
      SELECT
        "productId",
        string_agg(DISTINCT lower(alias), E'\\n' ORDER BY lower(alias)) AS "aliasSearchText"
      FROM "ProductAlias"
      GROUP BY "productId"
    `,
  );
  return new Map(rows.map((row) => [row.productId, row.aliasSearchText ?? ""]));
};

const loadTransactionProductOptionRows = async (): Promise<ProductOptionRow[]> => {
  const [rows, aliasSearchTextByProduct] = await Promise.all([
    withDbRetry(() =>
      db.product.findMany({
        orderBy: { code: "asc" },
        select: {
          id: true, code: true, name: true, description: true,
          salePrice: true, retailPrice: true, costPrice: true,
          saleUnitName: true, purchaseUnitName: true, warrantyDays: true,
          inventoryTracking: true, isLotControl: true, lotIssueMethod: true,
          allowExpiredIssue: true, requireExpiryDate: true,
          preferredSupplierId: true, isActive: true,
          category: { select: { name: true } },
          brand: { select: { name: true } },
          preferredSupplier: { select: { name: true, isActive: true } },
          units: { select: { name: true, scale: true, isBase: true }, orderBy: { isBase: "desc" } },
        },
      }),
    ),
    loadAliasSearchTextByProduct(),
  ]);
  return rows.map((product) => ({
    id: product.id, code: product.code, name: product.name,
    description: truncateOptionDescription(product.description),
    salePrice: Number(product.salePrice), retailPrice: Number(product.retailPrice),
    costPrice: Number(product.costPrice),
    saleUnitName: product.saleUnitName, purchaseUnitName: product.purchaseUnitName,
    warrantyDays: product.warrantyDays,
    inventoryTracking: product.inventoryTracking, isLotControl: product.isLotControl,
    lotIssueMethod: product.lotIssueMethod, allowExpiredIssue: product.allowExpiredIssue,
    requireExpiryDate: product.requireExpiryDate,
    preferredSupplierId: product.preferredSupplierId,
    preferredSupplierName: product.preferredSupplier?.name ?? null,
    preferredSupplierActive: product.preferredSupplier?.isActive ?? false,
    categoryName: product.category.name, brandName: product.brand?.name ?? null,
    aliasSearchText: aliasSearchTextByProduct.get(product.id) ?? "",
    units: product.units.map((unit) => ({ name: unit.name, scale: Number(unit.scale), isBase: unit.isBase })),
    isActive: product.isActive,
  }));
};

const getCompressedTransactionProductOptionRows = unstable_cache(
  async () => compressJsonForCache(await loadTransactionProductOptionRows()),
  // v3: description truncated to PRODUCT_OPTION_DESCRIPTION_MAX_CHARS and
  // aliasSearchText aggregated in SQL — bumped so stale v2 payloads are not served.
  ["admin-transaction-product-options-gzip-v3"],
  {
    tags: [TRANSACTION_PRODUCT_OPTIONS_TAG],
    revalidate: TRANSACTION_OPTIONS_REVALIDATE_SECONDS,
  },
);

const getTransactionProductOptionRows = async (): Promise<ProductOptionRow[]> =>
  decompressJsonFromCache<ProductOptionRow[]>(await getCompressedTransactionProductOptionRows());

/** Invalidate the cached transaction product-option list after a product mutation. */
export const invalidateTransactionProductOptions = (): void => {
  updateTag(TRANSACTION_PRODUCT_OPTIONS_TAG);
};

export const getSaleProductOptions = async () => {
  const rows = await getTransactionProductOptionRows();
  return rows.map((product) => ({
    id: product.id, code: product.code, name: product.name, description: product.description,
    salePrice: product.salePrice, retailPrice: product.retailPrice, saleUnitName: product.saleUnitName,
    warrantyDays: product.warrantyDays, categoryName: product.categoryName,
    brandName: product.brandName, aliasSearchText: product.aliasSearchText,
    units: product.units,
    preferredSupplierId: product.preferredSupplierActive ? product.preferredSupplierId : null,
    preferredSupplierName: product.preferredSupplierActive ? product.preferredSupplierName : null,
    isLotControl: isInventoryTracked(product.inventoryTracking) && product.isLotControl,
    lotIssueMethod: product.lotIssueMethod as string,
    allowExpiredIssue: product.allowExpiredIssue,
    isActive: product.isActive,
  }));
};

export const getPurchaseProductOptions = async () => {
  const rows = await getTransactionProductOptionRows();
  return rows.map((product) => ({
    id: product.id, code: product.code, name: product.name, description: product.description,
    purchaseUnitName: product.purchaseUnitName, costPrice: product.costPrice,
    categoryName: product.categoryName, brandName: product.brandName, aliasSearchText: product.aliasSearchText,
    units: product.units,
    isLotControl: isInventoryTracked(product.inventoryTracking) && product.isLotControl,
    requireExpiryDate: product.requireExpiryDate,
    isActive: product.isActive,
  }));
};

export const getCreditNoteProductOptions = async () => {
  const rows = await getTransactionProductOptionRows();
  return rows.map((product) => ({
    id: product.id, code: product.code, name: product.name, description: product.description,
    salePrice: product.salePrice, saleUnitName: product.saleUnitName ?? "",
    isLotControl: isInventoryTracked(product.inventoryTracking) && product.isLotControl,
    categoryName: product.categoryName, brandName: product.brandName, aliasSearchText: product.aliasSearchText,
    units: product.units,
    isActive: product.isActive,
  }));
};

export const getPurchaseReturnProductOptions = async () => {
  // avgCost moves on every stock-in, so read it live and merge onto the cached
  // superset. This live query is a lightweight 2-column scan (no joins).
  const [rows, avgCostRows] = await Promise.all([
    getTransactionProductOptionRows(),
    withDbRetry(() => db.product.findMany({ select: { id: true, avgCost: true } })),
  ]);
  const avgCostById = new Map(avgCostRows.map((row) => [row.id, Number(row.avgCost)]));
  return rows.map((product) => ({
    id: product.id, code: product.code, name: product.name, description: product.description,
    avgCost: avgCostById.get(product.id) ?? 0, costPrice: product.costPrice,
    inventoryTracking: product.inventoryTracking,
    isLotControl: isInventoryTracked(product.inventoryTracking) && product.isLotControl,
    categoryName: product.categoryName, brandName: product.brandName, aliasSearchText: product.aliasSearchText,
    units: product.units,
    isActive: product.isActive,
  }));
};
