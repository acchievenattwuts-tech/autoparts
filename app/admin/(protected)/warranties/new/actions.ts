"use server";

import { z } from "zod";

import { requirePermission } from "@/lib/require-auth";
import { searchTransactionProductDetailRows } from "@/lib/transaction-product-search";

import {
  toWarrantyProductOptions,
  WARRANTY_PRODUCT_QUERY_MAX_CHARS,
  type WarrantyProductOption,
} from "./warranty-product-options";

const querySchema = z.string().max(WARRANTY_PRODUCT_QUERY_MAX_CHARS);

/**
 * Product search for the on-site warranty form. Uses the same search as the sale / purchase
 * pickers (every product, not the first 500 by name) and keeps only active, non-Lot-Control
 * products. A failed search throws so the picker shows its "search failed, try again" message.
 */
export async function searchWarrantyProducts(query: string): Promise<WarrantyProductOption[]> {
  const session = await requirePermission("warranties.create").catch(() => null);
  if (!session?.user?.id) return [];

  const parsed = querySchema.safeParse(query);
  if (!parsed.success) return [];

  try {
    return toWarrantyProductOptions(await searchTransactionProductDetailRows(parsed.data));
  } catch (error) {
    console.error("[searchWarrantyProducts]", error);
    throw new Error("WARRANTY_PRODUCT_SEARCH_FAILED");
  }
}
