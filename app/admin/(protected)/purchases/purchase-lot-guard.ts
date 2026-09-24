import { validateLotRows, type LotSubRow } from "@/lib/lot-control-client";

export type PurchaseLineLotInput = {
  isTracked: boolean;
  isLotControl: boolean;
  /** Product setting: every lot row must carry an EXP date. */
  requireExpiryDate: boolean;
  lotItems: LotSubRow[];
  /** Line quantity in the selected unit — the same unit the lot rows use. */
  qty: number;
};

/**
 * A tracked, lot-controlled product must always name the lots it receives.
 * Without this, an empty `lotItems` raises StockCard but writes no ProductLot /
 * LotBalance. Mirrors the check PurchaseForm already runs before submitting, so
 * a form submission never reaches this error; it stops direct Server Action calls.
 * Same rule as the sale guard (`sales/sale-lot-guard.ts`), plus the product's
 * EXP requirement that only applies to stock coming in.
 *
 * Returns the Thai error message, or null when the line passes / is not lot-controlled.
 */
export const getPurchaseLineLotError = (line: PurchaseLineLotInput): string | null =>
  line.isTracked && line.isLotControl
    ? validateLotRows(line.lotItems, line.qty, line.requireExpiryDate)
    : null;
