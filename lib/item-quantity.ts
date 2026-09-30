/**
 * Document line quantities (E7 sales, ก5 purchases, 2026-09-30): `SaleItem.quantity` and
 * `PurchaseItem.quantity` are `Decimal(12,4)` in the product's BASE unit, like every StockCard
 * quantity. This module is the single place that decides how such a quantity is validated,
 * stored and displayed. It has no server-only imports, so client components use it too.
 *
 * Display rule (owner): an integer quantity renders exactly as before (no ".00"); a fractional
 * line renders with exactly 2 decimals (0.4 -> "0.40"). The sale and purchase forms therefore
 * accept at most 2 decimals, so nothing entered there is ever displayed rounded. The columns
 * keep 4 decimals for unit-scale conversions (qty x unit scale). Only lines the user added or
 * changed are validated; an unchanged saved line never blocks an edit.
 */

/** Scale of `SaleItem.quantity` / `PurchaseItem.quantity` and StockCard quantities (`Decimal(12,4)`). */
export const ITEM_QUANTITY_STORAGE_DECIMALS = 4;
/** Decimals the document forms accept and fractional lines display. */
export const ITEM_QUANTITY_INPUT_DECIMALS = 2;
/** Smallest positive quantity the forms accept (and their input step). */
export const ITEM_QUANTITY_INPUT_STEP = 0.01;
export const ITEM_QUANTITY_DECIMALS_ERROR = "จำนวนต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง";
export const ITEM_BASE_QUANTITY_DECIMALS_ERROR =
  "จำนวนเมื่อแปลงเป็นหน่วยนับหลักต้องมีทศนิยมไม่เกิน 4 ตำแหน่ง กรุณาปรับจำนวนหรือหน่วยนับ";
/** Excel format for a fractional quantity cell; integer cells keep each export's existing format. */
export const ITEM_QUANTITY_FRACTION_EXCEL_FORMAT = "#,##0.00";
/** Same, for exports whose quantity column shows negative (return) rows in red. */
export const ITEM_QUANTITY_FRACTION_EXCEL_SIGNED_FORMAT = "#,##0.00;[Red]-#,##0.00";

/** Float noise allowed when checking decimal places (values carry at most 12 significant digits). */
const DECIMAL_PLACES_TOLERANCE = 1e-7;
const DISPLAY_LOCALE = "th-TH";

/** A number, a numeric string, or a Prisma `Decimal` (anything whose `toString()` is numeric). */
export type ItemQuantityValue = number | string | { toString(): string };

export const toItemQuantityNumber = (value: ItemQuantityValue): number =>
  typeof value === "number" ? value : Number(value.toString());

export function roundItemQuantity(value: number, decimals: number = ITEM_QUANTITY_STORAGE_DECIMALS): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function hasAtMostDecimalPlaces(value: number, decimals: number): boolean {
  return Number.isFinite(value) && Math.abs(roundItemQuantity(value, decimals) - value) < DECIMAL_PLACES_TOLERANCE;
}

/** True when a form quantity has at most 2 decimals. */
export const isItemQuantityInputValid = (qty: number): boolean =>
  hasAtMostDecimalPlaces(qty, ITEM_QUANTITY_INPUT_DECIMALS);

/**
 * `step` for a quantity `<input>`: 0.01 while the value is valid; "any" otherwise, so the
 * browser's own step check never blocks the submit. The form's Thai message (for a changed
 * line) or nothing (for an unchanged saved line) decides instead.
 */
export const itemQuantityInputStep = (qty: number): number | "any" =>
  isItemQuantityInputValid(qty) ? ITEM_QUANTITY_INPUT_STEP : "any";

/** Identity of a saved line's quantity, so a form can tell an unchanged saved line from an edited one. */
export const itemQuantityLineKey = (line: { productId: string; unitName: string; qty: number }): string =>
  `${line.productId}|${line.unitName}|${line.qty}`;

/**
 * Thai error for the first submitted line whose quantity has more than 2 decimals, skipping
 * lines the caller reports as unchanged saved lines; null when every checked line is valid.
 */
export function findItemQuantityInputError(
  items: ReadonlyArray<{ qty: number }>,
  isUnchangedLine: (index: number) => boolean = () => false,
): string | null {
  const invalid = items.some((item, index) => !isUnchangedLine(index) && !isItemQuantityInputValid(item.qty));
  return invalid ? ITEM_QUANTITY_DECIMALS_ERROR : null;
}

/** True when the quantity (at storage precision) is not a whole number. */
export function isFractionalItemQuantity(value: ItemQuantityValue): boolean {
  const quantity = toItemQuantityNumber(value);
  return Number.isFinite(quantity) && !Number.isInteger(roundItemQuantity(quantity));
}

/**
 * Display text of one line quantity: integers exactly as `toLocaleString("th-TH")` rendered
 * them before (grouped thousands), fractional values with exactly 2 decimals. Pass
 * `useGrouping: false` where the old text was a plain template (`${qty}`), e.g. CSV cells and
 * stock-card detail text, so integers stay byte-identical there too.
 */
export function formatItemQuantity(
  value: ItemQuantityValue,
  options: { useGrouping?: boolean } = {},
): string {
  const quantity = toItemQuantityNumber(value);
  const grouping: Intl.NumberFormatOptions = options.useGrouping === false ? { useGrouping: false } : {};
  if (!isFractionalItemQuantity(quantity)) {
    const whole = Number.isFinite(quantity) ? roundItemQuantity(quantity) : quantity;
    return whole.toLocaleString(DISPLAY_LOCALE, grouping);
  }
  return quantity.toLocaleString(DISPLAY_LOCALE, {
    ...grouping,
    minimumFractionDigits: ITEM_QUANTITY_INPUT_DECIMALS,
    maximumFractionDigits: ITEM_QUANTITY_INPUT_DECIMALS,
  });
}

/**
 * Base-unit quantity stored in the line's `quantity` and its StockCard row for `qty` of a unit
 * whose base scale is `unitScale`, rounded to storage precision (removes float noise such as
 * 0.1 x 3). Returns null when the exact value needs more than 4 decimals, which the column
 * would silently round.
 */
export function toItemBaseQuantity(qty: number, unitScale: number): number | null {
  const baseQuantity = qty * unitScale;
  if (!hasAtMostDecimalPlaces(baseQuantity, ITEM_QUANTITY_STORAGE_DECIMALS)) return null;
  return roundItemQuantity(baseQuantity);
}

/**
 * Base quantity for a line being written. A line the user added or changed is refused (null)
 * when it needs more than 4 decimals; an unchanged saved line that is only rewritten (e.g. a
 * date change rebuilds every line) never blocks the edit and is stored at column precision.
 */
export function resolveItemBaseQuantity(qty: number, unitScale: number, isUnchangedLine: boolean): number | null {
  const exact = toItemBaseQuantity(qty, unitScale);
  if (exact !== null || !isUnchangedLine) return exact;
  return roundItemQuantity(qty * unitScale);
}
