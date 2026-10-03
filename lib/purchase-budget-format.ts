/** Number formatting for the purchase budget screens (dashboard tab + purchase form box). Client-safe. */

const PERCENT_FRACTION_DIGITS = 1;
const MONEY_FRACTION_DIGITS = 2;
const HALF_SATANG = 0.005;

export function formatBaht(value: number): string {
  const text = Math.abs(value).toLocaleString("th-TH", {
    minimumFractionDigits: MONEY_FRACTION_DIGITS,
    maximumFractionDigits: MONEY_FRACTION_DIGITS,
  });
  return value <= -HALF_SATANG ? `−${text}` : text;
}

/** "+1,234.00" / "−1,234.00" / "0.00". */
export function formatSignedBaht(value: number): string {
  if (Math.abs(value) < HALF_SATANG) return "0.00";
  return `${value > 0 ? "+" : "−"}${formatBaht(Math.abs(value))}`;
}

export function formatPercent(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: PERCENT_FRACTION_DIGITS,
    maximumFractionDigits: PERCENT_FRACTION_DIGITS,
  });
}
