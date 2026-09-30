import { Prisma } from "@/lib/generated/prisma";
import type { VatType } from "@/lib/vat";

const MONEY_SCALE = 2;
const QUANTITY_SCALE = 4;
const PERCENT_BASE = 100;
const CENTS_PER_UNIT = 100;

/**
 * vatRecoverable is decided by the caller from lib/input-vat.ts (review V1: VAT type and the shop's VAT
 * registration on the supplier's DN date), never from client input; this module only applies it.
 */
export type SupplierDebitAmountMode = "PER_UNIT" | "TOTAL";

type SupplierDebitVatInput = { vatType: VatType; vatRate: number; vatRecoverable: boolean };

export type SupplierDebitLineQuantityInput = {
  amountMode: SupplierDebitAmountMode;
  increaseAmount: number;
  affectedQuantity: number;
  unitScale: number;
};

export type SupplierDebitLineInput = SupplierDebitLineQuantityInput & SupplierDebitVatInput;

export type SupplierDebitLineAmounts = {
  affectedBaseQuantity: number;
  subtotalAmount: number;
  vatAmount: number;
  netAmount: number;
  costAdjustmentAmount: number;
};

export type SupplierDebitDocumentAmounts = {
  subtotalAmount: number;
  vatAmount: number;
  netAmount: number;
  lines: SupplierDebitLineAmounts[];
};

const money = (value: Prisma.Decimal): Prisma.Decimal =>
  value.toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP);

function validatedDecimal(value: number, field: string, allowZero: boolean): Prisma.Decimal {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error(`SUPPLIER_DEBIT_INVALID_${field}`);
  }
  return new Prisma.Decimal(value);
}

function validatedVat(input: Pick<SupplierDebitVatInput, "vatType" | "vatRate">): Prisma.Decimal {
  const rate = validatedDecimal(input.vatRate, "VAT_RATE", true);
  if (rate.gt(PERCENT_BASE)) throw new Error("SUPPLIER_DEBIT_INVALID_VAT_RATE");
  if (!["NO_VAT", "EXCLUDING_VAT", "INCLUDING_VAT"].includes(input.vatType)) {
    throw new Error("SUPPLIER_DEBIT_INVALID_VAT_TYPE");
  }
  return rate;
}

/** Base quantity and the entered money total of one line, before VAT. */
function enteredLine(input: SupplierDebitLineQuantityInput): { baseQuantity: Prisma.Decimal; enteredTotal: Prisma.Decimal } {
  const increase = validatedDecimal(input.increaseAmount, "AMOUNT", false);
  const quantity = validatedDecimal(input.affectedQuantity, "QUANTITY", false);
  const scale = validatedDecimal(input.unitScale, "UNIT_SCALE", false);
  if (!["PER_UNIT", "TOTAL"].includes(input.amountMode)) {
    throw new Error("SUPPLIER_DEBIT_INVALID_AMOUNT_MODE");
  }
  const baseQuantity = quantity.mul(scale);
  if (!baseQuantity.equals(baseQuantity.toDecimalPlaces(QUANTITY_SCALE))) {
    throw new Error("SUPPLIER_DEBIT_QUANTITY_PRECISION_EXCEEDED");
  }
  const enteredTotal = money(input.amountMode === "PER_UNIT" ? increase.mul(quantity) : increase);
  if (enteredTotal.lte(0)) throw new Error("SUPPLIER_DEBIT_AMOUNT_ROUNDS_TO_ZERO");
  return { baseQuantity, enteredTotal };
}

/**
 * Header VAT on the whole document, rounded once to the satang half-up (the rule the purchase
 * header's calcVat applies), so the DN matches the supplier's document instead of a sum of
 * separately rounded lines. Exact decimals avoid calcVat's binary floating-point half-cent drift.
 */
function documentVat(total: Prisma.Decimal, vatType: VatType, rate: Prisma.Decimal): Prisma.Decimal {
  if (vatType === "NO_VAT" || rate.lte(0)) return new Prisma.Decimal(0);
  return money(vatType === "INCLUDING_VAT"
    ? total.mul(rate).div(rate.plus(PERCENT_BASE))
    : total.mul(rate).div(PERCENT_BASE));
}

/**
 * Split whole satang across lines in proportion to their weights (largest remainder). Leftover
 * satang go to the largest fractional remainders; ties go to the earlier line, so the same input
 * order always yields the same split and the parts always sum to the total.
 */
function allocateBySatang(total: Prisma.Decimal, weights: Prisma.Decimal[]): Prisma.Decimal[] {
  const weightSum = weights.reduce((sum, weight) => sum.plus(weight), new Prisma.Decimal(0));
  const satang = total.mul(CENTS_PER_UNIT);
  if (weightSum.lte(0) || satang.lte(0)) return weights.map(() => new Prisma.Decimal(0));
  const shares = weights.map((weight, index) => {
    const exact = satang.mul(weight).div(weightSum);
    const floor = exact.floor();
    return { index, floor, remainder: exact.minus(floor) };
  });
  let leftover = satang.minus(shares.reduce((sum, share) => sum.plus(share.floor), new Prisma.Decimal(0))).toNumber();
  const byRemainder = [...shares].sort((a, b) => b.remainder.comparedTo(a.remainder) || a.index - b.index);
  const extra = new Set<number>();
  for (const share of byRemainder) {
    if (leftover <= 0) break;
    extra.add(share.index);
    leftover -= 1;
  }
  return shares.map((share) => share.floor.plus(extra.has(share.index) ? 1 : 0).div(CENTS_PER_UNIT));
}

/**
 * Normalize every price increase of one DN. VAT is computed once on the document subtotal and then
 * allocated to lines, so line VAT/net always sum to the header and a repost of the same input yields
 * identical numbers. With recoverable VAT (input tax) each line's cost adjustment is its subtotal; with
 * non-recoverable VAT it is the subtotal plus its allocated VAT. No receipt-to-stock allocation policy is derived here.
 */
export function calculateSupplierDebitDocument(
  input: SupplierDebitVatInput & { lines: SupplierDebitLineQuantityInput[] },
): SupplierDebitDocumentAmounts {
  const rate = validatedVat(input);
  const entered = input.lines.map(enteredLine);
  const total = entered.reduce((sum, line) => sum.plus(line.enteredTotal), new Prisma.Decimal(0));
  const vat = documentVat(total, input.vatType, rate);
  const lineVat = allocateBySatang(vat, entered.map((line) => line.enteredTotal));
  const lines = entered.map(({ baseQuantity, enteredTotal }, index): SupplierDebitLineAmounts => {
    const subtotal = input.vatType === "INCLUDING_VAT" ? enteredTotal.minus(lineVat[index]) : enteredTotal;
    const net = input.vatType === "EXCLUDING_VAT" ? subtotal.plus(lineVat[index]) : enteredTotal;
    return {
      affectedBaseQuantity: baseQuantity.toNumber(),
      subtotalAmount: subtotal.toNumber(),
      vatAmount: lineVat[index].toNumber(),
      netAmount: net.toNumber(),
      costAdjustmentAmount: (input.vatRecoverable ? subtotal : net).toNumber(),
    };
  });
  const subtotal = input.vatType === "INCLUDING_VAT" ? total.minus(vat) : total;
  return {
    subtotalAmount: subtotal.toNumber(),
    vatAmount: vat.toNumber(),
    netAmount: subtotal.plus(vat).toNumber(),
    lines,
  };
}

/** Single-line DN: header rounding and line rounding coincide. */
export function calculateSupplierDebitLine(input: SupplierDebitLineInput): SupplierDebitLineAmounts {
  const { vatType, vatRate, vatRecoverable, ...line } = input;
  return calculateSupplierDebitDocument({ vatType, vatRate, vatRecoverable, lines: [line] }).lines[0];
}

/** The caller supplies approved eligible quantity; this helper never guesses stock lineage. */
export function allocateSupplierDebitCost(input: {
  costAdjustmentAmount: number;
  affectedBaseQuantity: number;
  eligibleBaseQuantity: number;
}): { inventoryAmount: number; varianceAmount: number } {
  const cost = money(validatedDecimal(input.costAdjustmentAmount, "COST", false));
  const affected = validatedDecimal(input.affectedBaseQuantity, "QUANTITY", false);
  const eligible = validatedDecimal(input.eligibleBaseQuantity, "ELIGIBLE_QUANTITY", true);
  if (eligible.gt(affected)) throw new Error("SUPPLIER_DEBIT_ELIGIBLE_QUANTITY_EXCEEDED");
  const inventory = money(cost.mul(eligible).div(affected));
  return { inventoryAmount: inventory.toNumber(), varianceAmount: cost.minus(inventory).toNumber() };
}

/** Aggregate SKU coverage once; duplicate purchase lines share the same proportion. */
export function allocateSupplierDebitCoverage(
  lines: Array<{ productId: string; affectedBaseQuantity: number; costAdjustmentAmount: number }>,
  stockByProduct: ReadonlyMap<string, number>,
): Array<{ eligibleBaseQuantity: number; inventoryAmount: number; varianceAmount: number }> {
  const quantities = new Map<string, Prisma.Decimal>();
  for (const line of lines) {
    const quantity = validatedDecimal(line.affectedBaseQuantity, "QUANTITY", false);
    quantities.set(line.productId, (quantities.get(line.productId) ?? new Prisma.Decimal(0)).plus(quantity));
  }
  const accumulated = new Map<string, { cost: Prisma.Decimal; quantity: Prisma.Decimal }>();
  return lines.map((line) => {
    const total = quantities.get(line.productId)!;
    const rawStock = stockByProduct.get(line.productId) ?? 0;
    if (!Number.isFinite(rawStock)) throw new Error("SUPPLIER_DEBIT_INVALID_STOCK");
    const covered = Prisma.Decimal.min(total, Math.max(0, rawStock));
    const ratio = covered.div(total);
    const cost = money(validatedDecimal(line.costAdjustmentAmount, "COST", false));
    const previous = accumulated.get(line.productId) ?? { cost: new Prisma.Decimal(0), quantity: new Prisma.Decimal(0) };
    const nextCost = previous.cost.plus(cost);
    const nextQuantity = previous.quantity.plus(line.affectedBaseQuantity);
    // Cumulative rounding assigns each SKU's cent/quantity residual exactly once.
    const inventoryAmount = money(nextCost.mul(ratio)).minus(money(previous.cost.mul(ratio)));
    const eligibleBaseQuantity = nextQuantity.mul(ratio).toDecimalPlaces(QUANTITY_SCALE, Prisma.Decimal.ROUND_DOWN)
      .minus(previous.quantity.mul(ratio).toDecimalPlaces(QUANTITY_SCALE, Prisma.Decimal.ROUND_DOWN));
    accumulated.set(line.productId, { cost: nextCost, quantity: nextQuantity });
    return {
      eligibleBaseQuantity: eligibleBaseQuantity.toNumber(),
      inventoryAmount: inventoryAmount.toNumber(),
      varianceAmount: cost.minus(inventoryAmount).toNumber(),
    };
  });
}
