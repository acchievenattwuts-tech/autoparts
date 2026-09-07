import type { TransactionProductDetailRow } from "./transaction-product-search";

/** Quotations need selling prices only; never expose cost/lot data to this permission. */
export const quotationProductOption = (row: TransactionProductDetailRow) => ({
  id: row.id, code: row.code, name: row.name, description: row.description,
  categoryName: row.categoryName, brandName: row.brandName, isActive: row.isActive,
  salePrice: row.salePrice, retailPrice: row.retailPrice, memberPrice: row.memberPrice,
  priceListPrices: row.priceListPrices, pricePromotions: row.pricePromotions,
  saleUnitName: row.saleUnitName, units: row.units,
});
