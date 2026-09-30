import { calcVat, type VatType } from "@/lib/vat";

/**
 * Stock cost of a purchase (owner decision V2, 2026-09-30).
 *
 * Every purchase line goes to the StockCard at its entered price (`priceIn`); the difference
 * between the document's inventory cost base and the sum of line values is spread over the
 * lines as `landedCost`, by line value. This module is the single formula for that spread —
 * used by createPurchase / updatePurchase and by prisma/scripts/recalculate-purchase-landed-cost.ts.
 *
 * Cost base (V1 = option ข, lib/input-vat.ts): the header's pre-VAT amount after discount and
 * shipping (calcVat(...).subtotalAmount) when the input VAT is recoverable, else the header's
 * netAmount — non-recoverable VAT is always cost.
 *
 * - AS_ENTERED — NO_VAT (or a zero rate), recoverable EXCLUDING_VAT and non-recoverable
 *   INCLUDING_VAT. There the cost base already equals Σ line values + shipping − discount, so the
 *   spread is shippingFee − discount, allocated exactly as before V2 (byte-identical).
 * - PRE_VAT_RECOVERABLE — recoverable INCLUDING_VAT: spread = subtotalAmount − Σ line values.
 * - VAT_INCLUSIVE_NON_RECOVERABLE — non-recoverable EXCLUDING_VAT: spread = netAmount − Σ line
 *   values, i.e. shipping − discount + the VAT.
 * Both VAT spreads are allocated by line value in whole satang, largest remainder (ties → lower
 * line index).
 *
 * Examples: 10 × 107 + shipping 10.70, INCLUDING_VAT 7 %, recoverable → spread −60.00, stock cost
 * 1,010.00 (101.00/unit), VAT 70.70; not recoverable → spread +10.70, 1,080.70.
 * 10 × 100 EXCLUDING_VAT 7 % + shipping 10, not recoverable → spread +80.70, stock cost 1,080.70
 * (the net); recoverable → spread +10.00, 1,010.00.
 */

export type PurchaseCostingBasis = "AS_ENTERED" | "PRE_VAT_RECOVERABLE" | "VAT_INCLUSIVE_NON_RECOVERABLE";

/** One purchase line in the selected unit: quantity and entered price per selected unit. */
export type PurchaseCostLine = { qty: number; costPrice: number };

export type PurchaseCostingVat = {
  vatType: VatType;
  vatRate: number;
  /** isInputVatRecoverable() for this document (lib/input-vat.ts). */
  inputVatRecoverable: boolean;
};

export type PurchaseInventoryCostInput = PurchaseCostingVat & {
  lines: readonly PurchaseCostLine[];
  shippingFee: number;
  discount: number;
};

const SATANG_PER_BAHT = 100;
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const HUNDRED = BigInt(SATANG_PER_BAHT);

export function resolvePurchaseCostingBasis(input: PurchaseCostingVat): PurchaseCostingBasis {
  if (input.vatType === "NO_VAT" || !(Number(input.vatRate) > 0)) return "AS_ENTERED";
  if (input.vatType === "INCLUDING_VAT") return input.inputVatRecoverable ? "PRE_VAT_RECOVERABLE" : "AS_ENTERED";
  return input.inputVatRecoverable ? "AS_ENTERED" : "VAT_INCLUSIVE_NON_RECOVERABLE";
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * SATANG_PER_BAHT) / SATANG_PER_BAHT;
}

/**
 * The pre-V2 allocation, unchanged: (shippingFee − discount) spread by rounded line value, the
 * last line taking the rounding remainder. Kept verbatim so AS_ENTERED documents stay byte-identical.
 */
function allocateAsEntered(lineValues: readonly number[], netAdjustment: number): number[] {
  const roundedAdjustment = roundMoney(netAdjustment);
  if (roundedAdjustment === 0 || lineValues.length === 0) return lineValues.map(() => 0);

  const roundedValues = lineValues.map((value) => roundMoney(value));
  const totalLineValue = roundMoney(roundedValues.reduce((sum, value) => sum + value, 0));
  if (totalLineValue <= 0) return lineValues.map(() => 0);

  let allocatedTotal = 0;
  return roundedValues.map((lineValue, index) => {
    const amount = index === roundedValues.length - 1
      ? roundMoney(roundedAdjustment - allocatedTotal)
      : roundMoney((roundedAdjustment * lineValue) / totalLineValue);
    allocatedTotal = roundMoney(allocatedTotal + amount);
    return amount;
  });
}

/** A finite number as an exact decimal (units / 10^scale), read from its shortest round-trip text. */
type ExactDecimal = { units: bigint; scale: number };

function pow10(exponent: number): bigint {
  return BigInt(`1${"0".repeat(exponent)}`);
}

function toExactDecimal(value: number): ExactDecimal {
  if (!Number.isFinite(value)) return { units: ZERO, scale: 0 };
  const [mantissa, exponentText = "0"] = String(value).toLowerCase().split("e");
  const negative = mantissa.startsWith("-");
  const [integerDigits, fractionDigits = ""] = mantissa.replace("-", "").split(".");
  const digits = BigInt(`${integerDigits}${fractionDigits}`);
  const scale = fractionDigits.length - Number(exponentText);
  const units = scale < 0 ? digits * pow10(-scale) : digits;
  return { units: negative ? -units : units, scale: Math.max(scale, 0) };
}

/** numerator / denominator rounded half away from zero (denominator > 0). */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const magnitude = numerator < ZERO ? -numerator : numerator;
  const rounded = (magnitude * TWO + denominator) / (denominator * TWO);
  return numerator < ZERO ? -rounded : rounded;
}

function toSatang(value: number): bigint {
  const exact = toExactDecimal(value);
  return divideHalfUp(exact.units * HUNDRED, pow10(exact.scale));
}

/** Exact qty × costPrice of every line on one common scale (negative values count as zero weight). */
function exactLineValues(lines: readonly PurchaseCostLine[]): { values: bigint[]; scale: number } {
  const products = lines.map((line) => {
    const qty = toExactDecimal(line.qty);
    const price = toExactDecimal(line.costPrice);
    return { units: qty.units * price.units, scale: qty.scale + price.scale };
  });
  const scale = products.reduce((max, product) => Math.max(max, product.scale), 0);
  return {
    values: products.map((product) => {
      const units = product.units * pow10(scale - product.scale);
      return units > ZERO ? units : ZERO;
    }),
    scale,
  };
}

/**
 * Splits `amountSatang` over `weights` in whole satang: each line gets the floor of its exact
 * share, and the leftover satang go one each to the largest remainders (ties → lower index).
 * The result always sums to `amountSatang`; zero total weight gives all zeros.
 */
export function allocateSatangByLargestRemainder(amountSatang: bigint, weights: readonly bigint[]): bigint[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, ZERO);
  if (amountSatang === ZERO || totalWeight <= ZERO) return weights.map(() => ZERO);
  const negative = amountSatang < ZERO;
  const magnitude = negative ? -amountSatang : amountSatang;
  const shares = weights.map((weight, index) => ({
    index,
    floor: (magnitude * weight) / totalWeight,
    remainder: (magnitude * weight) % totalWeight,
  }));
  let leftover = magnitude - shares.reduce((sum, share) => sum + share.floor, ZERO);
  const byRemainder = [...shares].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  const allocated = shares.map((share) => share.floor);
  for (const share of byRemainder) {
    if (leftover <= ZERO) break;
    allocated[share.index] += ONE;
    leftover -= ONE;
  }
  return allocated.map((satang) => (negative ? -satang : satang));
}

/** The header amounts the purchase actions store, from the same inputs. */
export function computePurchaseHeaderAmounts(input: Pick<PurchaseInventoryCostInput, "lines" | "shippingFee" | "discount" | "vatType" | "vatRate">): {
  totalAmount: number;
  discountedTotal: number;
  subtotalAmount: number;
  vatAmount: number;
  netAmount: number;
} {
  const totalAmount = input.lines.reduce((sum, line) => sum + line.qty * line.costPrice, 0);
  const discountedTotal = Math.max(0, totalAmount + input.shippingFee - input.discount);
  const vat = calcVat(discountedTotal, input.vatType, input.vatRate);
  return { totalAmount, discountedTotal, ...vat };
}

/**
 * Landed cost (baht, whole satang, signed) per line — the StockCard `landedCost` of each line.
 * Σ(qty × costPrice) + Σ landed = the document's inventory cost base.
 */
export function allocatePurchaseLandedCost(input: PurchaseInventoryCostInput): number[] {
  const lineValues = input.lines.map((line) => line.qty * line.costPrice);
  const basis = resolvePurchaseCostingBasis(input);
  if (basis === "AS_ENTERED") {
    return allocateAsEntered(lineValues, input.shippingFee - input.discount);
  }
  const header = computePurchaseHeaderAmounts(input);
  const costBase = basis === "PRE_VAT_RECOVERABLE" ? header.subtotalAmount : header.netAmount;
  const { values, scale } = exactLineValues(input.lines);
  const lineTotalSatang = divideHalfUp(values.reduce((sum, value) => sum + value, ZERO) * HUNDRED, pow10(scale));
  const spreadSatang = toSatang(costBase) - lineTotalSatang;
  return allocateSatangByLargestRemainder(spreadSatang, values).map((satang) => Number(satang) / SATANG_PER_BAHT);
}
