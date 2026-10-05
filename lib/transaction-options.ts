import { revalidateTag, unstable_cache, updateTag } from "next/cache";

import { db, withDbRetry } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma";
import { isInventoryTracked } from "@/lib/inventory-tracking";
import { getTransactionProductDetailRowsByIds } from "@/lib/transaction-product-search";

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

// Customer Price List metadata plus compatibility tier are JSON-safe; no Decimal.
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
  customerType: {
    select: {
      priceTier: true,
      priceListId: true,
      priceList: {
        select: { id: true, code: true, name: true, channel: true, isActive: true },
      },
    },
  },
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

/**
 * Expire customer options after a mutation handled by a Route Handler.
 * `updateTag` is Server-Action-only in Next.js 16, so non-action entrypoints
 * must use `revalidateTag` instead.
 */
export const revalidateTransactionCustomerOptions = (): void => {
  revalidateTag(TRANSACTION_CUSTOMER_OPTIONS_TAG, { expire: 0 });
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
// Product options for admin transaction forms (sales / quotations / purchases /
// purchase-returns / credit-notes).
//
// The forms search on demand through the transaction product picker
// (lib/transaction-product-search.ts): a cached text-only catalog for matching,
// plus live detail rows (prices, units, cost) for the products actually picked.
// TRANSACTION_PRODUCT_OPTIONS_TAG tags that cached catalog. The old full-catalog
// loaders that shipped the whole product master to every form (~5.8 MB of
// database reads per cache miss) were removed on 2026-10-05 once nothing called them.
// -----------------------------------------------------------------------------

export const TRANSACTION_PRODUCT_OPTIONS_TAG = "admin-transaction:product-options";

/** Invalidate the cached transaction product-picker catalog after a product mutation. */
export const invalidateTransactionProductOptions = (): void => {
  updateTag(TRANSACTION_PRODUCT_OPTIONS_TAG);
};

export const getSaleProductOptionsByIds = async (ids: readonly string[]) =>
  (await getTransactionProductDetailRowsByIds(ids)).map((product) => ({
    id: product.id, code: product.code, name: product.name, description: product.description,
    salePrice: product.salePrice, retailPrice: product.retailPrice, memberPrice: product.memberPrice,
    priceListPrices: product.priceListPrices,
    pricePromotions: product.pricePromotions,
    saleUnitName: product.saleUnitName, warrantyDays: product.warrantyDays,
    categoryName: product.categoryName, brandName: product.brandName, units: product.units,
    preferredSupplierId: product.preferredSupplierActive ? product.preferredSupplierId : null,
    preferredSupplierName: product.preferredSupplierActive ? product.preferredSupplierName : null,
    isLotControl: isInventoryTracked(product.inventoryTracking) && product.isLotControl,
    lotIssueMethod: product.lotIssueMethod as string,
    allowExpiredIssue: product.allowExpiredIssue,
    isActive: product.isActive,
  }));

export const getPurchaseProductOptionsByIds = async (ids: readonly string[]) =>
  (await getTransactionProductDetailRowsByIds(ids)).map((product) => ({
    id: product.id, code: product.code, name: product.name, description: product.description,
    purchaseUnitName: product.purchaseUnitName, costPrice: product.costPrice,
    categoryName: product.categoryName, brandName: product.brandName, units: product.units,
    isLotControl: isInventoryTracked(product.inventoryTracking) && product.isLotControl,
    requireExpiryDate: product.requireExpiryDate,
    isActive: product.isActive,
  }));

export const getCreditNoteProductOptionsByIds = async (ids: readonly string[]) =>
  (await getTransactionProductDetailRowsByIds(ids)).map((product) => ({
    id: product.id, code: product.code, name: product.name, description: product.description,
    salePrice: product.salePrice, saleUnitName: product.saleUnitName ?? "",
    inventoryTracking: product.inventoryTracking,
    isLotControl: isInventoryTracked(product.inventoryTracking) && product.isLotControl,
    categoryName: product.categoryName, brandName: product.brandName, units: product.units,
    isActive: product.isActive,
  }));

export const getPurchaseReturnProductOptionsByIds = async (ids: readonly string[]) =>
  (await getTransactionProductDetailRowsByIds(ids)).map((product) => ({
    id: product.id, code: product.code, name: product.name, description: product.description,
    avgCost: product.avgCost, costPrice: product.costPrice,
    inventoryTracking: product.inventoryTracking,
    isLotControl: isInventoryTracked(product.inventoryTracking) && product.isLotControl,
    categoryName: product.categoryName, brandName: product.brandName, units: product.units,
    isActive: product.isActive,
  }));
