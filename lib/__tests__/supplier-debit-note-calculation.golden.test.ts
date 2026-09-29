import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocateSupplierDebitCost,
  calculateSupplierDebitLine,
  type SupplierDebitLineInput,
} from "@/lib/supplier-debit-note-calculation";

const baseInput: SupplierDebitLineInput = {
  amountMode: "PER_UNIT", increaseAmount: 50, affectedQuantity: 10,
  unitScale: 1, vatType: "NO_VAT", vatRate: 0, vatRecoverable: true,
};

describe("supplier DN Option B: hand-calculated golden amounts", () => {
  const fixtures = [
    {
      name: "ten units, no VAT",
      input: {},
      expected: { affectedBaseQuantity: 10, subtotalAmount: 500, vatAmount: 0,
        netAmount: 500, costAdjustmentAmount: 500 },
    },
    {
      name: "fifty per unit excluding recoverable VAT",
      input: { vatType: "EXCLUDING_VAT", vatRate: 7 },
      expected: { affectedBaseQuantity: 10, subtotalAmount: 500, vatAmount: 35,
        netAmount: 535, costAdjustmentAmount: 500 },
    },
    {
      name: "fifty per unit including recoverable VAT",
      input: { vatType: "INCLUDING_VAT", vatRate: 7 },
      expected: { affectedBaseQuantity: 10, subtotalAmount: 467.29, vatAmount: 32.71,
        netAmount: 500, costAdjustmentAmount: 467.29 },
    },
    {
      name: "nonrecoverable VAT is part of acquisition cost",
      input: { vatType: "EXCLUDING_VAT", vatRate: 7, vatRecoverable: false },
      expected: { affectedBaseQuantity: 10, subtotalAmount: 500, vatAmount: 35,
        netAmount: 535, costAdjustmentAmount: 535 },
    },
    {
      name: "total adjustment does not multiply by quantity",
      input: { amountMode: "TOTAL", increaseAmount: 500 },
      expected: { affectedBaseQuantity: 10, subtotalAmount: 500, vatAmount: 0,
        netAmount: 500, costAdjustmentAmount: 500 },
    },
    {
      name: "two packs of five, price increase per pack",
      input: { affectedQuantity: 2, unitScale: 5, increaseAmount: 250 },
      expected: { affectedBaseQuantity: 10, subtotalAmount: 500, vatAmount: 0,
        netAmount: 500, costAdjustmentAmount: 500 },
    },
    {
      name: "one item fifty including VAT",
      input: { affectedQuantity: 1, vatType: "INCLUDING_VAT", vatRate: 7 },
      expected: { affectedBaseQuantity: 1, subtotalAmount: 46.73, vatAmount: 3.27,
        netAmount: 50, costAdjustmentAmount: 46.73 },
    },
    {
      name: "fractional selected quantity converts to base units",
      input: { affectedQuantity: 0.5, unitScale: 2 },
      expected: { affectedBaseQuantity: 1, subtotalAmount: 25, vatAmount: 0,
        netAmount: 25, costAdjustmentAmount: 25 },
    },
  ] satisfies Array<{ name: string; input: Partial<SupplierDebitLineInput>;
    expected: ReturnType<typeof calculateSupplierDebitLine> }>;

  for (const fixture of fixtures) {
    it(fixture.name, () => {
      assert.deepEqual(calculateSupplierDebitLine({ ...baseInput, ...fixture.input }), fixture.expected);
    });
  }

  const allocations = [
    { name: "all ten eligible", cost: 500, affected: 10, eligible: 10,
      expected: { inventoryAmount: 500, varianceAmount: 0 } },
    { name: "six sold, four eligible", cost: 500, affected: 10, eligible: 4,
      expected: { inventoryAmount: 200, varianceAmount: 300 } },
    { name: "zero stock: all cost is current-period variance", cost: 500, affected: 10, eligible: 0,
      expected: { inventoryAmount: 0, varianceAmount: 500 } },
    { name: "recoverable VAT is excluded before allocation", cost: 467.29, affected: 10, eligible: 4,
      expected: { inventoryAmount: 186.92, varianceAmount: 280.37 } },
    { name: "cent residual remains in variance", cost: 0.05, affected: 3, eligible: 1,
      expected: { inventoryAmount: 0.02, varianceAmount: 0.03 } },
  ];
  for (const fixture of allocations) {
    it(fixture.name, () => {
      assert.deepEqual(allocateSupplierDebitCost({ costAdjustmentAmount: fixture.cost,
        affectedBaseQuantity: fixture.affected, eligibleBaseQuantity: fixture.eligible }), fixture.expected);
    });
  }

  it("rejects NaN, infinity, negative, zero and invalid quantity/scale", () => {
    for (const increaseAmount of [NaN, Infinity, -50, 0]) {
      assert.throws(() => calculateSupplierDebitLine({ ...baseInput, increaseAmount }), /INVALID_AMOUNT/);
    }
    assert.throws(() => calculateSupplierDebitLine({ ...baseInput, affectedQuantity: 0 }), /INVALID_QUANTITY/);
    assert.throws(() => calculateSupplierDebitLine({ ...baseInput, unitScale: 0 }), /INVALID_UNIT_SCALE/);
    assert.throws(() => calculateSupplierDebitLine({ ...baseInput, vatRate: -7 }), /INVALID_VAT_RATE/);
  });

  it("rejects eligible quantity beyond the affected quantity", () => {
    assert.throws(() => allocateSupplierDebitCost({ costAdjustmentAmount: 500,
      affectedBaseQuantity: 10, eligibleBaseQuantity: 11 }), /ELIGIBLE_QUANTITY_EXCEEDED/);
  });

  it("rejects sub-cent totals and unsupported quantity precision", () => {
    assert.throws(() => calculateSupplierDebitLine({ ...baseInput, increaseAmount: 0.0001 }), /ROUNDS_TO_ZERO/);
    assert.throws(() => calculateSupplierDebitLine({ ...baseInput, affectedQuantity: 0.00001 }), /PRECISION_EXCEEDED/);
  });
});
