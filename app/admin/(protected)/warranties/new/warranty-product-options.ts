import type { TransactionProductDetailRow } from "@/lib/transaction-product-search";

/** Longest text the on-site warranty product search accepts (anything longer is not a product query). */
export const WARRANTY_PRODUCT_QUERY_MAX_CHARS = 100;

/** A product the on-site warranty form can pick: what the shared product picker needs, nothing more. */
export type WarrantyProductOption = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  categoryName: string;
  brandName: string | null;
  isActive: boolean;
};

/**
 * Keeps the rule the form always had — active products that are not Lot Control, the same
 * `isLotControl` column createWarranty checks — and drops prices, cost and units, which the
 * warranty form does not use.
 */
export const toWarrantyProductOptions = (
  rows: readonly TransactionProductDetailRow[],
): WarrantyProductOption[] =>
  rows
    .filter((row) => row.isActive && !row.isLotControl)
    .map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      categoryName: row.categoryName,
      brandName: row.brandName,
      isActive: row.isActive,
    }));
