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

function toCents(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Invalid sale revenue amount");
  }
  return Math.round((value + Number.EPSILON) * MONEY_SCALE);
}

// Round cumulative targets, so a cent is assigned once and no last row is negative.
function allocateCents(total: number, weights: number[]): number[] {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal === 0) {
    if (total !== 0) throw new Error("Sale revenue has no allocation basis");
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
  if (vat < 0) throw new Error("Sale VAT total is negative");
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
