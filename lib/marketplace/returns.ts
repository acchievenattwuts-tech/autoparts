import { MarketplaceReturnStockDisposition } from "@/lib/generated/prisma";

const MONEY_SCALE = 100;
const QUANTITY_TOLERANCE = 0.0001;

export function calculateMarketplaceOrderOutstanding(
  saleAmount: number,
  returnAmount: number,
): number {
  return Math.round((saleAmount - returnAmount) * MONEY_SCALE) / MONEY_SCALE;
}

export function returnDispositionReversesStockCost(
  disposition: MarketplaceReturnStockDisposition,
): boolean {
  return disposition === MarketplaceReturnStockDisposition.RESTOCK;
}

export function isMarketplaceReturnQuantityAvailable(
  soldBaseQty: number,
  alreadyReturnedBaseQty: number,
  requestedBaseQty: number,
): boolean {
  const remaining = soldBaseQty - alreadyReturnedBaseQty;
  return requestedBaseQty - remaining <= QUANTITY_TOLERANCE;
}

