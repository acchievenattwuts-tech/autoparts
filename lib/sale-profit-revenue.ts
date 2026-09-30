/** Revenue comes from the posted document totals, including its VAT rounding.
 * Discount reduces products first, then shipping, matching the sale form.
 * Never use historical line subtotals as the document's tax authority.
 */
export type SaleProfitRevenueInput = {
  itemAmounts: number[];
  shippingFee: number;
  discount: number;
  subtotalAmount: number;
  netAmount: number;
};

export type ProfitRevenueAllocation = { exVat: number; incVat: number };

const MONEY_SCALE = 100;
/** Stored money has 2 decimals; the digit after them decides half-away-from-zero rounding. */
const STORED_MONEY_DECIMALS = 2;
const HALF_UP_DIGIT = 5;
/** Float noise of qty × price, in satang (far below a real third decimal, 0.1 satang). */
const SATANG_NOISE = 0.0001;

/** Thai message for a sale whose header totals cannot be split over its lines. */
export const SALE_REVENUE_ALLOCATION_USER_MESSAGE =
  "ยอดรวมของใบขายไม่ตรงกับยอดรวมรายการสินค้า จึงคำนวณยอดขายแยกรายการไม่ได้ กรุณาตรวจสอบราคาต่อหน่วย ส่วนลด และค่าส่ง (ใช้ทศนิยมไม่เกิน 2 ตำแหน่ง) แล้วบันทึกใหม่";

/**
 * The sale header does not reconcile with its line amounts. A condition the user can fix,
 * so the sale actions return `userMessage` instead of raising a critical alert. `message`
 * stays the technical text for logs.
 */
export class SaleRevenueAllocationError extends Error {
  readonly userMessage = SALE_REVENUE_ALLOCATION_USER_MESSAGE;
  constructor(message: string) {
    super(message);
    this.name = "SaleRevenueAllocationError";
  }
}

function toCents(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new SaleRevenueAllocationError("Invalid sale revenue amount");
  }
  return Math.round((value + Number.EPSILON) * MONEY_SCALE);
}

/**
 * Satang a Decimal(10,2) column stores for `value`: half away from zero on the value's
 * shortest decimal form, as PostgreSQL rounds the number Prisma sends.
 */
export function toStoredMoneyCents(value: number): number {
  if (!Number.isFinite(value)) throw new SaleRevenueAllocationError("Invalid sale line amount");
  const sign = value < 0 ? -1 : 1;
  const text = Math.abs(value).toString();
  if (text.includes("e")) return sign * Math.round(Math.abs(value) * MONEY_SCALE) || 0;
  const [whole, fraction = ""] = text.split(".");
  const kept = Number(fraction.slice(0, STORED_MONEY_DECIMALS).padEnd(STORED_MONEY_DECIMALS, "0"));
  const roundUp = Number(fraction.charAt(STORED_MONEY_DECIMALS) || "0") >= HALF_UP_DIGIT ? 1 : 0;
  return sign * (Number(whole) * MONEY_SCALE + kept + roundUp) || 0;
}

/** The amount a Decimal(10,2) column stores for `value`. */
export function roundStoredMoney(value: number): number {
  return toStoredMoneyCents(value) / MONEY_SCALE;
}

/** True when `value` has a real third decimal (not just qty × price float noise). */
export function hasMoreThanTwoDecimals(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const satang = value * MONEY_SCALE;
  return Math.abs(satang - Math.round(satang)) > SATANG_NOISE;
}

/**
 * Header product total for sale lines whose totals are stored with 2 decimals. When the
 * plain sum already rounds to Σ stored line totals it is returned unchanged, so a
 * reconciled sale keeps byte-identical header / VAT / net amounts. Otherwise (e.g. two
 * lines of 1 × 0.004: each line stores 0.00, the plain sum 0.008 would store 0.01) the
 * stored line totals are summed, so the header always equals Σ lines.
 */
export function sumSaleLineTotals(lineAmounts: readonly number[]): number {
  const plain = lineAmounts.reduce((sum, amount) => sum + amount, 0);
  // Never throws: invalid input keeps the plain sum and fails validation downstream.
  if (!Number.isFinite(plain) || !lineAmounts.every((amount) => Number.isFinite(amount))) return plain;
  const lineCents = lineAmounts.reduce((sum, amount) => sum + toStoredMoneyCents(amount), 0);
  return toStoredMoneyCents(plain) === lineCents ? plain : lineCents / MONEY_SCALE;
}

// Round cumulative targets, so a cent is assigned once and no last row is negative.
function allocateCents(total: number, weights: number[]): number[] {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal === 0) {
    if (total !== 0) throw new SaleRevenueAllocationError("Sale revenue has no allocation basis");
    return weights.map(() => 0);
  }
  let cumulativeWeight = 0;
  let allocated = 0;
  return weights.map((weight) => {
    cumulativeWeight += weight;
    const target = Math.round(total * (cumulativeWeight / weightTotal));
    const amount = target - allocated;
    allocated = target;
    return amount;
  });
}

/** Split a money total by weights in whole satang with the same cumulative rounding.
 * Every share keeps the total's sign, so no residual line flips negative. Negative or
 * non-finite weights count as zero; when no weight is positive the total splits equally.
 */
export function allocateMoneyByWeights(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  if (!Number.isFinite(total)) throw new Error("Invalid allocation total");
  const sign = total < 0 ? -1 : 1;
  const totalCents = Math.round((Math.abs(total) + Number.EPSILON) * MONEY_SCALE);
  const weightCents = weights.map((weight) =>
    Number.isFinite(weight) && weight > 0 ? Math.round((weight + Number.EPSILON) * MONEY_SCALE) : 0);
  const basis = weightCents.some((weight) => weight > 0) ? weightCents : weights.map(() => 1);
  return allocateCents(totalCents, basis).map((amount) =>
    amount === 0 ? 0 : (sign * amount) / MONEY_SCALE);
}

export function allocateSaleProfitRevenue(input: SaleProfitRevenueInput): {
  items: ProfitRevenueAllocation[];
  shipping: ProfitRevenueAllocation;
} {
  const itemWeights = input.itemAmounts.map(toCents);
  const itemTotal = itemWeights.reduce((sum, amount) => sum + amount, 0);
  const discount = toCents(input.discount);
  const shipping = toCents(input.shippingFee);
  const productAfterDiscount = Math.max(itemTotal - discount, 0);
  const shippingAfterDiscount = Math.max(shipping - Math.max(discount - itemTotal, 0), 0);
  const weights = [...allocateCents(productAfterDiscount, itemWeights), shippingAfterDiscount];
  const subtotal = toCents(input.subtotalAmount);
  const vat = toCents(input.netAmount) - subtotal;
  if (vat < 0) throw new SaleRevenueAllocationError("Sale VAT total is negative");
  const bases = allocateCents(subtotal, weights);
  const taxes = allocateCents(vat, weights);
  const allocations = bases.map((base, index) => ({
    exVat: base / MONEY_SCALE,
    incVat: (base + taxes[index]) / MONEY_SCALE,
  }));
  return {
    items: allocations.slice(0, itemWeights.length),
    shipping: allocations[itemWeights.length],
  };
}
