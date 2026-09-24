const MONEY_SCALE = 100;
const PRODUCT_QUANTITY_TOLERANCE = 0.0001;
const PRODUCT_MONEY_TOLERANCE = 0.005;

export function calculateMarketplaceOrderOutstanding(
  saleAmount: number,
  returnAmount: number,
): number {
  return Math.round((saleAmount - returnAmount) * MONEY_SCALE) / MONEY_SCALE;
}

export function isFullyReversedMarketplaceProduct(input: {
  quantity: number;
  salesAmount: number;
  grossProfit: number;
}): boolean {
  return (
    Math.abs(input.quantity) <= PRODUCT_QUANTITY_TOLERANCE &&
    Math.abs(input.salesAmount) <= PRODUCT_MONEY_TOLERANCE &&
    Math.abs(input.grossProfit) <= PRODUCT_MONEY_TOLERANCE
  );
}
