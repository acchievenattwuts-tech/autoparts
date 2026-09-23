const MONEY_SCALE = 100;

export function calculateMarketplaceOrderOutstanding(
  saleAmount: number,
  returnAmount: number,
): number {
  return Math.round((saleAmount - returnAmount) * MONEY_SCALE) / MONEY_SCALE;
}
