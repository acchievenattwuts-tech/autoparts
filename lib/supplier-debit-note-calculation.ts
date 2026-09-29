import { Prisma } from "@/lib/generated/prisma";
import type { VatType } from "@/lib/vat";

const MONEY_SCALE = 2;
const QUANTITY_SCALE = 4;
const PERCENT_BASE = 100;

export type SupplierDebitAmountMode = "PER_UNIT" | "TOTAL";

export type SupplierDebitLineInput = {
  amountMode: SupplierDebitAmountMode;
  increaseAmount: number;
  affectedQuantity: number;
  unitScale: number;
  vatType: VatType;
  vatRate: number;
  vatRecoverable: boolean;
};

export type SupplierDebitLineAmounts = {
  affectedBaseQuantity: number;
  subtotalAmount: number;
  vatAmount: number;
  netAmount: number;
  costAdjustmentAmount: number;
};

const money = (value: Prisma.Decimal): Prisma.Decimal =>
  value.toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP);

function validatedDecimal(value: number, field: string, allowZero: boolean): Prisma.Decimal {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error(`SUPPLIER_DEBIT_INVALID_${field}`);
  }
  return new Prisma.Decimal(value);
}

/** Normalize a price increase without deriving any receipt-to-stock allocation policy. */
export function calculateSupplierDebitLine(input: SupplierDebitLineInput): SupplierDebitLineAmounts {
  const increase = validatedDecimal(input.increaseAmount, "AMOUNT", false);
  const quantity = validatedDecimal(input.affectedQuantity, "QUANTITY", false);
  const scale = validatedDecimal(input.unitScale, "UNIT_SCALE", false);
  const rate = validatedDecimal(input.vatRate, "VAT_RATE", true);
  if (rate.gt(PERCENT_BASE)) throw new Error("SUPPLIER_DEBIT_INVALID_VAT_RATE");
  if (!["PER_UNIT", "TOTAL"].includes(input.amountMode)) {
    throw new Error("SUPPLIER_DEBIT_INVALID_AMOUNT_MODE");
  }
  if (!["NO_VAT", "EXCLUDING_VAT", "INCLUDING_VAT"].includes(input.vatType)) {
    throw new Error("SUPPLIER_DEBIT_INVALID_VAT_TYPE");
  }
  const baseQuantity = quantity.mul(scale);
  if (!baseQuantity.equals(baseQuantity.toDecimalPlaces(QUANTITY_SCALE))) {
    throw new Error("SUPPLIER_DEBIT_QUANTITY_PRECISION_EXCEEDED");
  }
  const enteredTotal = money(input.amountMode === "PER_UNIT" ? increase.mul(quantity) : increase);
  if (enteredTotal.lte(0)) throw new Error("SUPPLIER_DEBIT_AMOUNT_ROUNDS_TO_ZERO");
  const hasVat = input.vatType !== "NO_VAT" && rate.gt(0);
  const vat = !hasVat ? new Prisma.Decimal(0) : money(
    input.vatType === "INCLUDING_VAT"
      ? enteredTotal.mul(rate).div(rate.plus(PERCENT_BASE))
      : enteredTotal.mul(rate).div(PERCENT_BASE),
  );
  const subtotal = input.vatType === "INCLUDING_VAT" ? enteredTotal.minus(vat) : enteredTotal;
  const net = input.vatType === "EXCLUDING_VAT" ? subtotal.plus(vat) : enteredTotal;
  return {
    affectedBaseQuantity: baseQuantity.toNumber(),
    subtotalAmount: subtotal.toNumber(),
    vatAmount: vat.toNumber(),
    netAmount: net.toNumber(),
    costAdjustmentAmount: (input.vatRecoverable ? subtotal : net).toNumber(),
  };
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
