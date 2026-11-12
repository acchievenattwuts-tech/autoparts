/**
 * "ราคา/หน่วย" on a stock adjustment line is the price per the unit chosen on that line (owner,
 * 2026-11-12); the server divides it by the unit's scale for the base-unit cost. These helpers keep
 * the form's price in step with the chosen unit. A line in the base unit (scale 1) keeps exactly the
 * price it had before.
 */

type UnitScale = { name: string; scale: number };

/** Two decimals, the precision of the price field. */
const PRICE_ROUNDING_FACTOR = 100;

/** Scale of the line's unit; a line with no unit chosen yet counts as the base unit. */
export const getAdjustmentUnitScale = (units: readonly UnitScale[] | undefined, unitName: string): number =>
  units?.find((unit) => unit.name === unitName)?.scale ?? 1;

/** The same per-base-unit cost expressed per the new unit; unchanged when the scale does not change. */
export const rescaleAdjustmentUnitPrice = (price: number, fromScale: number, toScale: number): number => {
  if (fromScale === toScale || !(fromScale > 0) || !(toScale > 0)) return price;
  return Math.round((price / fromScale) * toScale * PRICE_ROUNDING_FACTOR) / PRICE_ROUNDING_FACTOR;
};
