import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { calcVat } from "@/lib/vat";
import {
  allocateSupplierDebitCost,
  calculateSupplierDebitDocument,
  calculateSupplierDebitLine,
  type SupplierDebitLineInput,
  type SupplierDebitLineQuantityInput,
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

describe("supplier DN: header VAT allocated to lines (hand-calculated goldens)", () => {
  const perUnit = (increaseAmount: number, affectedQuantity = 1): SupplierDebitLineQuantityInput =>
    ({ amountMode: "PER_UNIT", increaseAmount, affectedQuantity, unitScale: 1 });
  const nonRecoverable = { vatRecoverable: false };
  const sum = (values: number[]): number => values.reduce((total, value) => total.plus(value), new Prisma.Decimal(0)).toNumber();
  const assertLinesSumToHeader = (result: ReturnType<typeof calculateSupplierDebitDocument>): void => {
    assert.equal(sum(result.lines.map((line) => line.subtotalAmount)), result.subtotalAmount);
    assert.equal(sum(result.lines.map((line) => line.vatAmount)), result.vatAmount);
    assert.equal(sum(result.lines.map((line) => line.netAmount)), result.netAmount);
  };

  it("V1: recoverability is the caller's decision (lib/input-vat.ts); the module holds no fixed policy", async () => {
    const calculation = await import("@/lib/supplier-debit-note-calculation");
    assert.equal("INPUT_VAT_RECOVERABLE" in calculation, false);
    // 50 x 10 excluding 7%: AP 535 either way; cost 500 when the VAT is input tax, 535 when it is cost.
    const lines = [perUnit(50, 10)];
    assert.equal(calculateSupplierDebitDocument({ vatType: "EXCLUDING_VAT", vatRate: 7, vatRecoverable: true, lines }).lines[0].costAdjustmentAmount, 500);
    assert.equal(calculateSupplierDebitDocument({ vatType: "EXCLUDING_VAT", vatRate: 7, ...nonRecoverable, lines }).lines[0].costAdjustmentAmount, 535);
  });

  it("3 x 10.05 excluding 7%: VAT 2.11 / net 32.26 like the supplier (per-line rounding gave 2.10 / 32.25)", () => {
    // 30.15 x 7% = 2.1105 -> 2.11; 211 satang / 3 = 70.33 each, the one leftover satang goes to line 1.
    const result = calculateSupplierDebitDocument({ vatType: "EXCLUDING_VAT", vatRate: 7, ...nonRecoverable,
      lines: [perUnit(10.05), perUnit(10.05), perUnit(10.05)] });
    assert.deepEqual({ subtotal: result.subtotalAmount, vat: result.vatAmount, net: result.netAmount }, { subtotal: 30.15, vat: 2.11, net: 32.26 });
    assert.deepEqual(result.lines.map((line) => line.vatAmount), [0.71, 0.7, 0.7]);
    assert.deepEqual(result.lines.map((line) => line.netAmount), [10.76, 10.75, 10.75]);
    assert.deepEqual(result.lines.map((line) => line.costAdjustmentAmount), [10.76, 10.75, 10.75]);
    assertLinesSumToHeader(result);
  });

  it("20 x 0.07 excluding 7%: VAT 0.10 (per-line rounding gave 0.00), first ten lines carry one satang", () => {
    // 1.40 x 7% = 0.098 -> 0.10; 10 satang / 20 lines = 0.5 each, ties go to the earlier lines.
    const result = calculateSupplierDebitDocument({ vatType: "EXCLUDING_VAT", vatRate: 7, ...nonRecoverable,
      lines: Array.from({ length: 20 }, () => perUnit(0.07)) });
    assert.deepEqual({ subtotal: result.subtotalAmount, vat: result.vatAmount, net: result.netAmount }, { subtotal: 1.4, vat: 0.1, net: 1.5 });
    assert.deepEqual(result.lines.map((line) => line.vatAmount), [...Array(10).fill(0.01), ...Array(10).fill(0)]);
    assert.deepEqual(result.lines.map((line) => line.costAdjustmentAmount), [...Array(10).fill(0.08), ...Array(10).fill(0.07)]);
    assertLinesSumToHeader(result);
  });

  it("3 x 10.05 including 7%: VAT 1.97 on the document (per-line rounding gave 1.98)", () => {
    // 30.15 x 7/107 = 1.97243 -> 1.97; 197 satang / 3 = 65.67 each, two leftover satang to lines 1 and 2.
    const result = calculateSupplierDebitDocument({ vatType: "INCLUDING_VAT", vatRate: 7, ...nonRecoverable,
      lines: [perUnit(10.05), perUnit(10.05), perUnit(10.05)] });
    assert.deepEqual({ subtotal: result.subtotalAmount, vat: result.vatAmount, net: result.netAmount }, { subtotal: 28.18, vat: 1.97, net: 30.15 });
    assert.deepEqual(result.lines.map((line) => line.vatAmount), [0.66, 0.66, 0.65]);
    assert.deepEqual(result.lines.map((line) => line.subtotalAmount), [9.39, 9.39, 9.4]);
    assert.deepEqual(result.lines.map((line) => line.costAdjustmentAmount), [10.05, 10.05, 10.05]);
    assertLinesSumToHeader(result);
  });

  it("unequal lines use largest remainder: 10.00 / 20.00 / 0.05 excluding 7%", () => {
    // 30.05 x 7% = 2.1035 -> 2.10; shares 69.884 / 139.767 / 0.349 satang -> floors 69/139/0, +1 to lines 1 and 2.
    const result = calculateSupplierDebitDocument({ vatType: "EXCLUDING_VAT", vatRate: 7, ...nonRecoverable,
      lines: [perUnit(10), perUnit(20), perUnit(0.05)] });
    assert.deepEqual(result.lines.map((line) => line.vatAmount), [0.7, 1.4, 0]);
    assert.deepEqual(result.lines.map((line) => line.netAmount), [10.7, 21.4, 0.05]);
    assert.equal(result.netAmount, 32.15);
    assertLinesSumToHeader(result);
  });

  it("spec case 4 without VAT recovery: 50/unit x 10 including 7% -> AP 500 is the cost; 4 eligible -> 200 / 300", () => {
    const [line] = calculateSupplierDebitDocument({ vatType: "INCLUDING_VAT", vatRate: 7, ...nonRecoverable, lines: [perUnit(50, 10)] }).lines;
    assert.deepEqual(line, { affectedBaseQuantity: 10, subtotalAmount: 467.29, vatAmount: 32.71, netAmount: 500, costAdjustmentAmount: 500 });
    assert.deepEqual(allocateSupplierDebitCost({ costAdjustmentAmount: line.costAdjustmentAmount, affectedBaseQuantity: 10,
      eligibleBaseQuantity: 4 }), { inventoryAmount: 200, varianceAmount: 300 });
  });

  it("spec case 5 without VAT recovery: 50/unit x 10 excluding 7% -> AP 535 is the cost; 4 eligible -> 214 / 321", () => {
    const [line] = calculateSupplierDebitDocument({ vatType: "EXCLUDING_VAT", vatRate: 7, ...nonRecoverable, lines: [perUnit(50, 10)] }).lines;
    assert.deepEqual(line, { affectedBaseQuantity: 10, subtotalAmount: 500, vatAmount: 35, netAmount: 535, costAdjustmentAmount: 535 });
    assert.deepEqual(allocateSupplierDebitCost({ costAdjustmentAmount: line.costAdjustmentAmount, affectedBaseQuantity: 10,
      eligibleBaseQuantity: 4 }), { inventoryAmount: 214, varianceAmount: 321 });
  });

  it("repost of the same input yields identical numbers", () => {
    const input = { vatType: "EXCLUDING_VAT" as const, vatRate: 7, ...nonRecoverable,
      lines: [perUnit(10), perUnit(20), perUnit(0.05), perUnit(10.05, 3)] };
    assert.deepEqual(calculateSupplierDebitDocument(input), calculateSupplierDebitDocument(structuredClone(input)));
  });

  const SWEEP_MAX_SATANG = 5_000; // every subtotal 0.01-50.00
  it("header VAT equals the purchase header calcVat at 7% for every subtotal (both use exact half-up)", () => {
    const mismatched: string[] = [];
    for (let satang = 1; satang <= SWEEP_MAX_SATANG; satang += 1) {
      const total = new Prisma.Decimal(satang).div(100).toNumber();
      for (const vatType of ["EXCLUDING_VAT", "INCLUDING_VAT"] as const) {
        const ours = calculateSupplierDebitDocument({ vatType, vatRate: 7, ...nonRecoverable,
          lines: [{ amountMode: "TOTAL", increaseAmount: total, affectedQuantity: 1, unitScale: 1 }] });
        const purchase = calcVat(total, vatType, 7);
        if (ours.vatAmount !== purchase.vatAmount) mismatched.push(`${vatType} ${total}: ${ours.vatAmount} vs ${purchase.vatAmount}`);
      }
    }
    // 14.50 x 7% = 1.015 exactly: both now give 1.02 (calcVat used to give 1.01 before the exact-rounding fix).
    assert.deepEqual(mismatched, []);
    assert.equal(calcVat(14.5, "EXCLUDING_VAT", 7).vatAmount, 1.02);
  });
});
