import type { StockCardSource } from "@/lib/generated/prisma";

/**
 * Value-only StockCard sources: quantity zero, the posting lives in valueAdjustment (inventory) and
 * costVariance (the uncovered part, posting-period variance).
 *
 * - SUPPLIER_DEBIT: a supplier DN and its "ปรับยอด DN" adjustments (lib/supplier-debit-note.ts).
 * - PURCHASE_ALLOWANCE: V8 (owner approved 2026-09-30, W1–W7) a purchase return of type DISCOUNT/OTHER lowers stock
 *   cost like a negative DN adjustment ("ลดราคาซื้อ", lib/purchase-allowance.ts).
 *
 * Both share every valuation rule: the same-day valuation epoch, the value-only replay branch and T3 clamp, the
 * backdating barrier of writeStockCard, the mutation-guard stock boundary and the sale-cost restatement on edit or
 * cancel. DN-only concerns (DN numbers, payments, adjustments) stay keyed on SUPPLIER_DEBIT.
 */
export const VALUE_ONLY_STOCK_SOURCES = ["SUPPLIER_DEBIT", "PURCHASE_ALLOWANCE"] as const satisfies readonly StockCardSource[];
export type ValueOnlyStockSource = (typeof VALUE_ONLY_STOCK_SOURCES)[number];

export const PURCHASE_ALLOWANCE_SOURCE = "PURCHASE_ALLOWANCE" satisfies ValueOnlyStockSource;

/** Stock card, report and profit label of a PURCHASE_ALLOWANCE row / fact. */
export const PURCHASE_ALLOWANCE_LABEL = "ลดราคาซื้อ";

export function isValueOnlyStockSource(source: string | null | undefined): source is ValueOnlyStockSource {
  return source === "SUPPLIER_DEBIT" || source === "PURCHASE_ALLOWANCE";
}

/** A mutable copy for Prisma `in` filters. */
export const valueOnlyStockSources = (): ValueOnlyStockSource[] => [...VALUE_ONLY_STOCK_SOURCES];

/** Thai name of the document behind a value-only row, used in boundary messages. */
export function describeValueOnlyStockDocument(source: string | null | undefined): string {
  return source === PURCHASE_ALLOWANCE_SOURCE ? "ใบลดหนี้ซื้อ (ลดราคาซื้อ)" : "ใบเพิ่มหนี้";
}
