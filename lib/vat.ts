export type VatType = "NO_VAT" | "EXCLUDING_VAT" | "INCLUDING_VAT";

export interface VatResult {
  subtotalAmount: number; // ยอดก่อนภาษี (หลังส่วนลด)
  vatAmount:      number; // ยอดภาษี
  netAmount:      number; // ยอดสุทธิ (ที่จ่ายจริง)
}

// BigInt() calls, not literals: the TypeScript target is ES2017.
const ZERO = BigInt(0);
const TWO = BigInt(2);
const SATANG_PER_BAHT = BigInt(100);
const PERCENT_BASE = BigInt(100);
/** A rate at or below -100% has no tax-inclusive base (division by zero or sign flip). */
const MAX_VAT_DISCOUNT_PCT = 100;

/** A finite JS number as an exact decimal: units / 10^scale. */
type ExactDecimal = { units: bigint; scale: number };

function pow10(exponent: number): bigint {
  return BigInt(`1${"0".repeat(exponent)}`);
}

/**
 * Reads the shortest round-trip decimal of the number (what was typed or stored),
 * so 14.5 is exactly 14.5 and not the nearest binary double.
 */
function toExactDecimal(value: number): ExactDecimal {
  const [mantissa, exponentText = "0"] = String(value).toLowerCase().split("e");
  const negative = mantissa.startsWith("-");
  const [integerDigits, fractionDigits = ""] = mantissa.replace("-", "").split(".");
  const digits = BigInt(`${integerDigits}${fractionDigits}`);
  const scale = fractionDigits.length - Number(exponentText);
  const units = scale < 0 ? digits * pow10(-scale) : digits;
  return { units: negative ? -units : units, scale: Math.max(scale, 0) };
}

/** numerator / denominator rounded to a whole unit, half away from zero (denominator > 0). */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const magnitude = numerator < ZERO ? -numerator : numerator;
  const rounded = (magnitude * TWO + denominator) / (denominator * TWO);
  return numerator < ZERO ? -rounded : rounded;
}

function toSatang(value: number): bigint {
  const exact = toExactDecimal(value);
  return divideHalfUp(exact.units * SATANG_PER_BAHT, pow10(exact.scale));
}

function fromSatang(satang: bigint): number {
  return Number(satang) / Number(SATANG_PER_BAHT);
}

/**
 * Exact VAT on a tax-inclusive or tax-exclusive total held in whole satang. The total is
 * rounded to the satang first (the amount the document stores), VAT is rounded once half-up,
 * and the remaining amount is derived, so net = subtotal + VAT to the satang.
 */
function calcVatSatang(
  totalSatang: bigint,
  vatType: "EXCLUDING_VAT" | "INCLUDING_VAT",
  vatRate: number,
): { subtotal: bigint; vat: bigint; net: bigint } {
  const rate = toExactDecimal(vatRate);
  const percentBase = PERCENT_BASE * pow10(rate.scale);
  if (vatType === "EXCLUDING_VAT") {
    const vat = divideHalfUp(totalSatang * rate.units, percentBase);
    return { subtotal: totalSatang, vat, net: totalSatang + vat };
  }
  const vat = divideHalfUp(totalSatang * rate.units, percentBase + rate.units);
  return { subtotal: totalSatang - vat, vat, net: totalSatang };
}

/**
 * Calculate VAT from a discounted total
 * @param discountedTotal - total after discount, before VAT adjustment
 * @param vatType - VAT type
 * @param vatRate - VAT rate as percentage (e.g. 7 for 7%)
 */
export function calcVat(
  discountedTotal: number,
  vatType: VatType,
  vatRate: number
): VatResult {
  if (vatType === "NO_VAT" || vatRate === 0) {
    return {
      subtotalAmount: discountedTotal,
      vatAmount:      0,
      netAmount:      discountedTotal,
    };
  }
  // Invalid input yields NaN as the float formula did, instead of throwing inside a form render.
  if (!Number.isFinite(discountedTotal) || !Number.isFinite(vatRate) || vatRate <= -MAX_VAT_DISCOUNT_PCT) {
    return { subtotalAmount: Number.NaN, vatAmount: Number.NaN, netAmount: Number.NaN };
  }
  const result = calcVatSatang(toSatang(discountedTotal), vatType, vatRate);
  return {
    subtotalAmount: fromSatang(result.subtotal),
    vatAmount:      fromSatang(result.vat),
    netAmount:      fromSatang(result.net),
  };
}

/**
 * Calculate item-level subtotalAmount (before tax)
 */
export function calcItemSubtotal(
  itemTotal: number,
  vatType: VatType,
  vatRate: number
): number {
  if (vatType === "INCLUDING_VAT" && vatRate > 0) {
    // Same rule as the document header, so a one-line document's line base equals its subtotal.
    return calcVat(itemTotal, vatType, vatRate).subtotalAmount;
  }
  return itemTotal; // NO_VAT or EXCLUDING_VAT: entered price is already pre-tax
}

export const VAT_TYPE_LABELS: Record<VatType, string> = {
  NO_VAT:        "ไม่มีภาษี",
  EXCLUDING_VAT: "ราคาไม่รวม VAT",
  INCLUDING_VAT: "ราคารวม VAT",
};
