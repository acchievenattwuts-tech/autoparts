import { validateLotRows, type LotSubRow } from "@/lib/lot-control-client";

/** Shown on an ADJUST_OUT line when the product has no lot with stock left to pick from. */
export const NO_LOT_STOCK_MESSAGE = "สินค้านี้ไม่มี Lot คงเหลือ จึงปรับลดสต๊อกแบบระบุ Lot ไม่ได้";

export type AdjustmentLineLotInput = {
  isTracked: boolean;
  isLotControl: boolean;
  /** Product setting: every lot row coming in must carry an EXP date. */
  requireExpiryDate: boolean;
  type: "ADJUST_IN" | "ADJUST_OUT";
  lotItems: LotSubRow[];
  /** Line quantity in the selected unit — the same unit the lot rows use. */
  qty: number;
};

/**
 * A tracked, lot-controlled product must always name the lots it adjusts.
 * Without this, an empty `lotItems` moves StockCard but not ProductLot / LotBalance.
 * Same rule as the sale and purchase guards (`sales/sale-lot-guard.ts`,
 * `purchases/purchase-lot-guard.ts`): the EXP requirement applies only to stock
 * coming in (ADJUST_IN); ADJUST_OUT lot availability is still checked when the
 * lots are written (`writeAdjustmentLots`).
 *
 * Returns the Thai error message, or null when the line passes / is not lot-controlled.
 */
export const getAdjustmentLineLotError = (line: AdjustmentLineLotInput): string | null =>
  line.isTracked && line.isLotControl
    ? validateLotRows(line.lotItems, line.qty, line.type === "ADJUST_IN" && line.requireExpiryDate)
    : null;
