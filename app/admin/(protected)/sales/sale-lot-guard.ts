import { validateLotRows, type LotSubRow } from "@/lib/lot-control-client";

/**
 * Thrown inside the sale transaction so the whole write rolls back and the Thai
 * message reaches the form (instead of the generic "เกิดข้อผิดพลาด" error).
 */
export class SaleLotValidationError extends Error {}

export type SaleLineLotInput = {
  isTracked: boolean;
  isLotControl: boolean;
  lotItems: LotSubRow[];
  /** Line quantity in the selected unit — the same unit the lot rows use. */
  qty: number;
};

/**
 * A tracked, lot-controlled product must always name the lots it issues.
 * Without this, an empty `lotItems` deducts StockCard but not LotBalance.
 * Mirrors the check SaleForm already runs before submitting, so a form
 * submission never reaches this error; it stops direct Server Action calls.
 *
 * Returns the Thai error message, or null when the line passes / is not lot-controlled.
 */
export const getSaleLineLotError = (line: SaleLineLotInput): string | null =>
  line.isTracked && line.isLotControl ? validateLotRows(line.lotItems, line.qty, false) : null;
