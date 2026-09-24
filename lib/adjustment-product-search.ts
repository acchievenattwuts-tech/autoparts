import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma";
import { INVENTORY_TRACKING_TRACKED } from "@/lib/inventory-tracking";

/**
 * Product picker data for the stock-adjustment form (/admin/stock/adjustments).
 * Only the fields AdjustmentForm reads are selected, so the page no longer ships
 * the whole catalog (descriptions, aliases, stock) to the browser.
 */
export const ADJUSTMENT_PRODUCT_SEARCH_LIMIT = 20;
/** ProductSearchSelect only searches from 3 characters (same as TRANSACTION_PRODUCT_SEARCH_MIN_CHARS). */
export const ADJUSTMENT_PRODUCT_SEARCH_MIN_CHARS = 3;

export type AdjustmentProductOption = {
  id: string;
  code: string;
  name: string;
  categoryName: string;
  brandName: string | null;
  costPrice: number;
  salePrice: number;
  isActive: boolean;
  isLotControl: boolean;
  requireExpiryDate: boolean;
  lotIssueMethod: string;
  units: { name: string; scale: number; isBase: boolean }[];
};

const adjustmentProductSelect = {
  id: true,
  code: true,
  name: true,
  costPrice: true,
  salePrice: true,
  isActive: true,
  isLotControl: true,
  requireExpiryDate: true,
  lotIssueMethod: true,
  category: { select: { name: true } },
  brand: { select: { name: true } },
  units: {
    select: { name: true, scale: true, isBase: true },
    orderBy: { isBase: "desc" },
  },
} satisfies Prisma.ProductSelect;

type AdjustmentProductRow = Prisma.ProductGetPayload<{ select: typeof adjustmentProductSelect }>;

export const toAdjustmentProductOption = (row: AdjustmentProductRow): AdjustmentProductOption => ({
  id: row.id,
  code: row.code,
  name: row.name,
  categoryName: row.category.name,
  brandName: row.brand?.name ?? null,
  costPrice: Number(row.costPrice),
  salePrice: Number(row.salePrice),
  isActive: row.isActive,
  isLotControl: row.isLotControl,
  requireExpiryDate: row.requireExpiryDate,
  lotIssueMethod: row.lotIssueMethod,
  units: row.units.map((unit) => ({ name: unit.name, scale: Number(unit.scale), isBase: unit.isBase })),
});

/** Where clause for a picker search: active, stock-tracked products matching the query. */
export const buildAdjustmentProductSearchWhere = (query: string): Prisma.ProductWhereInput => {
  const contains = { contains: query, mode: "insensitive" } as const;
  return {
    isActive: true,
    inventoryTracking: INVENTORY_TRACKING_TRACKED,
    OR: [
      { code: contains },
      { name: contains },
      { description: contains },
      { category: { name: contains } },
      { brand: { name: contains } },
      { aliases: { some: { alias: contains } } },
    ],
  };
};

/**
 * Same matching fields as the sale/purchase picker (code, name, description,
 * category, brand, alias; case-insensitive substring), restricted to active
 * stock-tracked products and capped at ADJUSTMENT_PRODUCT_SEARCH_LIMIT rows.
 */
export const searchAdjustmentProductOptions = async (query: string): Promise<AdjustmentProductOption[]> => {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < ADJUSTMENT_PRODUCT_SEARCH_MIN_CHARS) return [];
  const rows = await db.product.findMany({
    where: buildAdjustmentProductSearchWhere(normalizedQuery),
    orderBy: [{ code: "asc" }, { id: "asc" }],
    take: ADJUSTMENT_PRODUCT_SEARCH_LIMIT,
    select: adjustmentProductSelect,
  });
  return rows.map(toAdjustmentProductOption);
};
