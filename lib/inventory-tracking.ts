export const INVENTORY_TRACKING_TRACKED = "TRACKED";
export const INVENTORY_TRACKING_NON_TRACKED = "NON_TRACKED";

export type InventoryTrackingValue =
  | typeof INVENTORY_TRACKING_TRACKED
  | typeof INVENTORY_TRACKING_NON_TRACKED;

export function isInventoryTracked(value: string | null | undefined): boolean {
  return value !== INVENTORY_TRACKING_NON_TRACKED;
}

export function resolveSaleUnitCost(input: {
  inventoryTracking: string | null | undefined;
  avgCost: unknown;
  costPrice: unknown;
}): number {
  return isInventoryTracked(input.inventoryTracking)
    ? Number(input.avgCost)
    : Number(input.costPrice);
}
