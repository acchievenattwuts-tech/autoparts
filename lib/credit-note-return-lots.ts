// Client-safe helpers for credit-note RETURN lots that reference a sale (no DB imports).
//
// A RETURN line linked to a sale line may only bring back lots that the sale line
// took out. The form pre-fills those lots; the server re-checks them
// (credit-notes/credit-note-sale-lots.ts).

import type { LotSubRow } from "@/lib/lot-control-client";

const QTY_PRECISION = 10000;
const QTY_TOLERANCE = 0.0001;
const MAX_LOT_NO_LENGTH = 100;
const RETURN_LOT_PREFIX = "RET-";
const RETURN_LOT_ID_SUFFIX_LENGTH = 8;

/**
 * A lot the referenced sale line sold that can still be returned. Kept in base units
 * so the line can change its unit; convert with the unit scale when shown.
 */
export interface SaleLotOption {
  lotNo: string;
  /** Sold minus already returned by other ACTIVE credit notes, in base units. */
  baseQty: number;
  /** Sale-time lot cost per base unit. */
  unitCostBase: number;
  mfgDate: string;
  expDate: string;
}

export interface CreditNoteReturnLotRow extends LotSubRow {
  isReturnLot: boolean;
}

const roundQty = (value: number): number => Math.round(value * QTY_PRECISION) / QTY_PRECISION;
const safeScaleOf = (scale: number): number => (scale > 0 ? scale : 1);

/** A dash and the last 8 characters of the credit-note line id, appended to a RET- lot. */
const returnLotSuffix = (creditNoteItemId: string): string =>
  `-${creditNoteItemId.slice(-RETURN_LOT_ID_SUFFIX_LENGTH)}`;

/** The RET- lot number written for a returned lot kept separate from its source lot. */
export function buildReturnLotNo(sourceLotNo: string, creditNoteItemId: string): string {
  const suffix = returnLotSuffix(creditNoteItemId);
  const maxSourceLength = Math.max(1, MAX_LOT_NO_LENGTH - RETURN_LOT_PREFIX.length - suffix.length);
  return `${RETURN_LOT_PREFIX}${sourceLotNo.slice(0, maxSourceLength)}${suffix}`;
}

/**
 * The source lot a stored CreditNoteItemLot came from. A RET- lot is stored as
 * RET-<source>-<last 8 of the CN line id>, so both the prefix and that suffix are
 * removed; a merged lot is stored under the source lot number already.
 */
export function creditNoteSourceLotNo(
  lotNo: string,
  isReturnLot: boolean,
  creditNoteItemId: string,
): string {
  if (!isReturnLot) return lotNo;
  const suffix = returnLotSuffix(creditNoteItemId);
  const withoutPrefix = lotNo.startsWith(RETURN_LOT_PREFIX) ? lotNo.slice(RETURN_LOT_PREFIX.length) : lotNo;
  return withoutPrefix.endsWith(suffix) ? withoutPrefix.slice(0, -suffix.length) : withoutPrefix;
}

/**
 * Matches a source lot number against the sale's lots. A very long source lot is
 * cut short inside its RET- name, so a unique prefix match is accepted for those.
 */
export function matchSaleLotNo(sourceLotNo: string, saleLotNos: readonly string[]): string | null {
  if (saleLotNos.includes(sourceLotNo)) return sourceLotNo;
  if (!sourceLotNo) return null;
  const prefixMatches = saleLotNos.filter((lotNo) => lotNo.startsWith(sourceLotNo));
  return prefixMatches.length === 1 ? prefixMatches[0] : null;
}

/** Base quantity per lot that the given lines use (each lot row qty times its line's scale). */
export function sumLotBaseQty(
  lines: readonly { lotItems: readonly { lotNo: string; qty: number }[]; scale: number }[],
): Map<string, number> {
  const used = new Map<string, number>();
  for (const line of lines) {
    for (const lot of line.lotItems) {
      used.set(lot.lotNo, roundQty((used.get(lot.lotNo) ?? 0) + lot.qty * line.scale));
    }
  }
  return used;
}

/** Sale lots left after the base quantities other lines of this credit note already use. */
export function remainingSaleLots(
  saleLots: readonly SaleLotOption[],
  usedBaseQtyByLotNo: ReadonlyMap<string, number>,
): SaleLotOption[] {
  return saleLots.map((lot) => ({
    ...lot,
    baseQty: roundQty(Math.max(0, lot.baseQty - (usedBaseQtyByLotNo.get(lot.lotNo) ?? 0))),
  }));
}

/** A sale lot as a lot row in the line's unit (scale = base units per unit). */
export function saleLotToRow(
  lot: SaleLotOption,
  qty: number,
  scale: number,
  isReturnLot = false,
): CreditNoteReturnLotRow {
  return {
    lotNo: lot.lotNo,
    qty,
    unitCost: lot.unitCostBase * safeScaleOf(scale),
    mfgDate: lot.mfgDate,
    expDate: lot.expDate,
    isReturnLot,
  };
}

/**
 * Spreads a return quantity over the sale's lots in sale order. The RET- choice
 * already made for a lot is kept. Returns fewer rows than needed only when the
 * lots cannot cover the quantity; validation then reports the shortfall.
 */
export function allocateSaleLots(
  saleLots: readonly SaleLotOption[],
  qty: number,
  scale: number,
  previousRows: readonly CreditNoteReturnLotRow[] = [],
): CreditNoteReturnLotRow[] {
  const safeScale = safeScaleOf(scale);
  const returnFlagByLotNo = new Map(previousRows.map((row) => [row.lotNo, row.isReturnLot]));
  const rows: CreditNoteReturnLotRow[] = [];
  let remaining = roundQty(qty);
  for (const lot of saleLots) {
    if (remaining <= QTY_TOLERANCE) break;
    const allocated = roundQty(Math.min(lot.baseQty / safeScale, remaining));
    if (allocated <= QTY_TOLERANCE) continue;
    rows.push(saleLotToRow(lot, allocated, safeScale, returnFlagByLotNo.get(lot.lotNo) ?? false));
    remaining = roundQty(remaining - allocated);
  }
  return rows;
}

/**
 * The first lot row of a sale-linked line that is not in the sale, or that exceeds
 * what the sale line can still return (pass saleLots already reduced by the other
 * lines' use). Mirrors the server guard so the problem shows before saving.
 */
export function findSaleLotRowError(
  saleLots: readonly SaleLotOption[],
  rows: readonly { lotNo: string; qty: number }[],
  scale: number,
  unitName: string,
): string | null {
  const safeScale = safeScaleOf(scale);
  const requested = sumLotBaseQty([{ lotItems: rows, scale: safeScale }]);
  for (const [lotNo, baseQty] of requested) {
    const saleLot = saleLots.find((lot) => lot.lotNo === lotNo);
    if (!saleLot) return `Lot ${lotNo} ไม่อยู่ในรายการขายของใบขายต้นทาง กรุณาเลือก Lot จากใบขาย`;
    if (baseQty > saleLot.baseQty + QTY_TOLERANCE) {
      return `Lot ${lotNo} คืนได้อีกไม่เกิน ${roundQty(saleLot.baseQty / safeScale)} ${unitName} ตามใบขายต้นทาง`;
    }
  }
  return null;
}
