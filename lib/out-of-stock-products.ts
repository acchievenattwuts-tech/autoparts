import type { Prisma } from "@/lib/generated/prisma";
import { INVENTORY_TRACKING_TRACKED } from "@/lib/inventory-tracking";

export function buildOutOfStockProductsWhere(): Prisma.ProductWhereInput {
  return {
    isActive: true,
    inventoryTracking: INVENTORY_TRACKING_TRACKED,
    stock: { lte: 0 },
  };
}
