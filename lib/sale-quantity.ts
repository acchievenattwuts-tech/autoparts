/**
 * Sale-named aliases of `lib/item-quantity.ts` (E7). Sales code and its tests import these
 * names; the rules live once in the neutral module shared with purchases (ก5).
 */
export {
  ITEM_QUANTITY_STORAGE_DECIMALS as SALE_QUANTITY_STORAGE_DECIMALS,
  ITEM_QUANTITY_INPUT_DECIMALS as SALE_QUANTITY_INPUT_DECIMALS,
  ITEM_QUANTITY_INPUT_STEP as SALE_QUANTITY_INPUT_STEP,
  ITEM_QUANTITY_DECIMALS_ERROR as SALE_QUANTITY_DECIMALS_ERROR,
  ITEM_BASE_QUANTITY_DECIMALS_ERROR as SALE_BASE_QUANTITY_DECIMALS_ERROR,
  ITEM_QUANTITY_FRACTION_EXCEL_FORMAT as SALE_QUANTITY_FRACTION_EXCEL_FORMAT,
  ITEM_QUANTITY_FRACTION_EXCEL_SIGNED_FORMAT as SALE_QUANTITY_FRACTION_EXCEL_SIGNED_FORMAT,
  toItemQuantityNumber as toSaleQuantityNumber,
  roundItemQuantity as roundSaleQuantity,
  isFractionalItemQuantity as isFractionalSaleQuantity,
  formatItemQuantity as formatSaleQuantity,
  toItemBaseQuantity as toSaleBaseQuantity,
  resolveItemBaseQuantity as resolveSaleBaseQuantity,
  findItemQuantityInputError as findSaleQuantityInputError,
  itemQuantityInputStep as saleQuantityInputStep,
  hasAtMostDecimalPlaces,
} from "@/lib/item-quantity";
export type { ItemQuantityValue as SaleQuantityValue } from "@/lib/item-quantity";
