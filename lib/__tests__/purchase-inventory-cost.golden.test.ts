import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import {
  allocatePurchaseLandedCost,
  allocateSatangByLargestRemainder,
  computePurchaseHeaderAmounts,
  resolvePurchaseCostingBasis,
  type PurchaseCostLine,
  type PurchaseInventoryCostInput,
} from "@/lib/purchase-inventory-cost";
import { replayStockCardMavg, type StockReplayRow } from "@/lib/stock-card";
import { describeInputVatTreatment } from "@/lib/input-vat";
import { parseDateOnlyToDate } from "@/lib/th-date";
import type { VatType } from "@/lib/vat";

// Owner decisions V1 (option ข) / V2 (2026-09-30): the stock cost base is the pre-VAT amount after
// header discount and shipping when the input VAT is recoverable, else the net — non-recoverable VAT
// is always cost. NO_VAT, recoverable EXCLUDING_VAT and non-recoverable INCLUDING_VAT keep exactly the
// allocation they had before (byte-identical priceIn / landedCost / MAVG); recoverable INCLUDING_VAT
// drops the VAT from cost and non-recoverable EXCLUDING_VAT adds it.

/**
 * FROZEN copy of allocateLandedByLineValue() as it stood in app/admin/(protected)/purchases/actions.ts
 * before V2 (and allocateByLineValue() in prisma/scripts/recalculate-purchase-landed-cost.ts). Never
 * edit: it is the golden reference the AS_ENTERED branch must reproduce bit for bit.
 */
function legacyAllocateLandedByLineValue(items: readonly PurchaseCostLine[], netAdjustment: number): number[] {
  const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
  const allocation = new Map<number, number>();
  const roundedAdjustment = roundMoney(netAdjustment);
  if (roundedAdjustment === 0 || items.length === 0) {
    items.forEach((_, index) => allocation.set(index, 0));
    return items.map((_, index) => allocation.get(index) ?? 0);
  }
  const lineValues = items.map((item) => roundMoney(item.qty * item.costPrice));
  const totalLineValue = roundMoney(lineValues.reduce((sum, value) => sum + value, 0));
  if (totalLineValue <= 0) {
    items.forEach((_, index) => allocation.set(index, 0));
    return items.map((_, index) => allocation.get(index) ?? 0);
  }
  let allocatedTotal = 0;
  lineValues.forEach((lineValue, index) => {
    const amount = index === lineValues.length - 1
      ? roundMoney(roundedAdjustment - allocatedTotal)
      : roundMoney((roundedAdjustment * lineValue) / totalLineValue);
    allocation.set(index, amount);
    allocatedTotal = roundMoney(allocatedTotal + amount);
  });
  return items.map((_, index) => allocation.get(index) ?? 0);
}

const D = (value: number | string): Prisma.Decimal => new Prisma.Decimal(value);
const col4 = (value: number): Prisma.Decimal => D(String(value)).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
const col2 = (value: number): Prisma.Decimal => D(String(value)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** The PURCHASE StockCard rows createPurchase writes for base-unit lines (scale 1), as stored. */
function purchaseRows(lines: readonly PurchaseCostLine[], landed: readonly number[]): StockReplayRow[] {
  return lines.map((line, index) => ({
    id: `sc-${index}`,
    docDate: new Date("2026-09-30T00:00:00+07:00"),
    sorder: index + 1,
    source: "PURCHASE",
    qtyIn: col4(line.qty),
    qtyOut: D(0),
    priceIn: col4(line.costPrice),
    landedCost: col2(landed[index]),
    usesReferenceCost: false,
    qtyBalance: D(0),
    priceBalance: D(0),
    priceOut: D(0),
  }));
}

/** Satang of a money amount, exact for 2-decimal values. */
const satang = (value: number): number => Math.round(value * 100);

// ── The owner's worked example ────────────────────────────────────────────────

const EXAMPLE: Omit<PurchaseInventoryCostInput, "inputVatRecoverable"> = {
  lines: [{ qty: 10, costPrice: 107 }],
  shippingFee: 10.7,
  discount: 0,
  vatType: "INCLUDING_VAT",
  vatRate: 7,
};

test("golden: 10 × 107 + shipping 10.70, INCLUDING_VAT 7 %, recoverable → stock 1,010.00 (101.00/unit), VAT 70.70", () => {
  const header = computePurchaseHeaderAmounts(EXAMPLE);
  assert.deepEqual(
    { subtotalAmount: header.subtotalAmount, vatAmount: header.vatAmount, netAmount: header.netAmount },
    { subtotalAmount: 1010, vatAmount: 70.7, netAmount: 1080.7 },
  );
  const landed = allocatePurchaseLandedCost({ ...EXAMPLE, inputVatRecoverable: true });
  assert.deepEqual(landed, [-60]);
  const replay = replayStockCardMavg(purchaseRows(EXAMPLE.lines, landed));
  assert.equal(replay.finalQty, 10);
  assert.equal(replay.finalPrice, 101);
});

test("golden: the same document not recoverable → stock 1,080.70 (108.07/unit), exactly as before V2", () => {
  const landed = allocatePurchaseLandedCost({ ...EXAMPLE, inputVatRecoverable: false });
  assert.deepEqual(landed, [10.7]);
  assert.deepEqual(landed, legacyAllocateLandedByLineValue(EXAMPLE.lines, EXAMPLE.shippingFee - EXAMPLE.discount));
  const replay = replayStockCardMavg(purchaseRows(EXAMPLE.lines, landed));
  assert.equal(replay.finalPrice, 108.07);
});

test("golden: two lines, shipping 10.70 − discount 5, recoverable INCLUDING_VAT 7 % → largest-remainder satang", () => {
  const input: PurchaseInventoryCostInput = {
    lines: [{ qty: 24, costPrice: 150 }, { qty: 3, costPrice: 150 }],
    shippingFee: 10.7,
    discount: 5,
    vatType: "INCLUDING_VAT",
    vatRate: 7,
    inputVatRecoverable: true,
  };
  // net 4,055.70 → VAT 265.33, pre-VAT 3,790.37; spread 3,790.37 − 4,050.00 = −259.63 split 8 : 1.
  assert.equal(computePurchaseHeaderAmounts(input).subtotalAmount, 3790.37);
  assert.deepEqual(allocatePurchaseLandedCost(input), [-230.78, -28.85]);
});

test("golden: 10 × 100 EXCLUDING_VAT 7 % + shipping 10, not recoverable → stock 1,080.70 = net (VAT is cost)", () => {
  const input: Omit<PurchaseInventoryCostInput, "inputVatRecoverable"> = {
    lines: [{ qty: 10, costPrice: 100 }], shippingFee: 10, discount: 0, vatType: "EXCLUDING_VAT", vatRate: 7,
  };
  const header = computePurchaseHeaderAmounts(input);
  assert.deepEqual(
    { subtotalAmount: header.subtotalAmount, vatAmount: header.vatAmount, netAmount: header.netAmount },
    { subtotalAmount: 1010, vatAmount: 70.7, netAmount: 1080.7 },
  );
  const landed = allocatePurchaseLandedCost({ ...input, inputVatRecoverable: false });
  assert.equal(resolvePurchaseCostingBasis({ ...input, inputVatRecoverable: false }), "VAT_INCLUSIVE_NON_RECOVERABLE");
  assert.deepEqual(landed, [80.7], "shipping 10.00 + VAT 70.70");
  assert.equal(replayStockCardMavg(purchaseRows(input.lines, landed)).finalPrice, 108.07);
  // Recoverable: exactly the pre-V2 value (1,010.00, 101.00/unit).
  const recoverable = allocatePurchaseLandedCost({ ...input, inputVatRecoverable: true });
  assert.deepEqual(recoverable, [10]);
  assert.ok(sameBits(recoverable, legacyAllocateLandedByLineValue(input.lines, 10)));
  assert.equal(replayStockCardMavg(purchaseRows(input.lines, recoverable)).finalPrice, 101);
});

test("golden: two lines, shipping 10.70 − discount 5, EXCLUDING_VAT 7 % not recoverable → +VAT by largest remainder", () => {
  const input: PurchaseInventoryCostInput = {
    lines: [{ qty: 24, costPrice: 150 }, { qty: 3, costPrice: 150 }],
    shippingFee: 10.7,
    discount: 5,
    vatType: "EXCLUDING_VAT",
    vatRate: 7,
    inputVatRecoverable: false,
  };
  // pre-VAT 4,055.70 → VAT 283.90, net 4,339.60; spread 4,339.60 − 4,050.00 = 289.60 split 8 : 1.
  assert.equal(computePurchaseHeaderAmounts(input).netAmount, 4339.6);
  assert.deepEqual(allocatePurchaseLandedCost(input), [257.42, 32.18]);
});

test("costing basis matrix (V1 option ข)", () => {
  const basis = (vatType: VatType, vatRate: number, inputVatRecoverable: boolean) =>
    resolvePurchaseCostingBasis({ vatType, vatRate, inputVatRecoverable });
  assert.equal(basis("NO_VAT", 0, false), "AS_ENTERED");
  assert.equal(basis("NO_VAT", 7, true), "AS_ENTERED");
  assert.equal(basis("EXCLUDING_VAT", 0, false), "AS_ENTERED");
  assert.equal(basis("INCLUDING_VAT", 0, true), "AS_ENTERED");
  assert.equal(basis("EXCLUDING_VAT", 7, true), "AS_ENTERED");
  assert.equal(basis("EXCLUDING_VAT", 7, false), "VAT_INCLUSIVE_NON_RECOVERABLE");
  assert.equal(basis("INCLUDING_VAT", 7, true), "PRE_VAT_RECOVERABLE");
  assert.equal(basis("INCLUDING_VAT", 7, false), "AS_ENTERED");
});

test("the stored stock cost matches the on-screen note: pre-VAT when recoverable, VAT-inclusive net otherwise", () => {
  const registeredFrom = parseDateOnlyToDate("2026-09-01");
  const lines = [{ qty: 10, costPrice: 100 }];
  for (const vatType of ["INCLUDING_VAT", "EXCLUDING_VAT"] as const) {
    for (const taxInvoiceDate of ["2026-09-30", "2026-08-31"]) {
      const decision = { vatType, vatRate: 7, taxDocumentDate: parseDateOnlyToDate(taxInvoiceDate), registeredFrom };
      const inputVatRecoverable = taxInvoiceDate >= "2026-09-01";
      const input: PurchaseInventoryCostInput = { lines, shippingFee: 10, discount: 0, vatType, vatRate: 7, inputVatRecoverable };
      const header = computePurchaseHeaderAmounts(input);
      const stockCostSatang = satang(1000) + allocatePurchaseLandedCost(input).reduce((sum, amount) => sum + satang(amount), 0);
      const note = describeInputVatTreatment(decision);
      const label = `${vatType} ${taxInvoiceDate}: ${note}`;
      if (inputVatRecoverable) {
        assert.equal(stockCostSatang, satang(header.subtotalAmount), label);
        assert.match(note, /ไม่รวมในต้นทุน/, label);
      } else {
        assert.equal(stockCostSatang, satang(header.netAmount), label);
        assert.match(note, /VAT รวมเป็นต้นทุนทั้งจำนวน/, label);
      }
    }
  }
});

// ── AS_ENTERED is byte-identical to the pre-V2 allocation ────────────────────

/** Line sets used by the existing purchase fixtures (purchase-*.test.ts) plus rounding edge cases. */
const FIXTURE_LINE_SETS: PurchaseCostLine[][] = [
  [{ qty: 20.5, costPrice: 150 }],
  [{ qty: 2, costPrice: 1800 }, { qty: 3, costPrice: 150 }],
  [{ qty: 0.125, costPrice: 150 }, { qty: 20.5, costPrice: 150 }],
  [{ qty: 0.25, costPrice: 18.75 }],
  [{ qty: 2, costPrice: 50 }],
  [{ qty: 2, costPrice: 45 }],
  [{ qty: 3, costPrice: 33.3333 }, { qty: 1, costPrice: 10 }, { qty: 2, costPrice: 0.01 }],
  [{ qty: 1, costPrice: 0 }, { qty: 1, costPrice: 0 }],
  [{ qty: 7, costPrice: 14.29 }, { qty: 11, costPrice: 9.09 }, { qty: 13, costPrice: 7.69 }],
];
const FIXTURE_HEADERS = [
  { shippingFee: 0, discount: 0 },
  { shippingFee: 10.7, discount: 0 },
  { shippingFee: 0, discount: 5 },
  { shippingFee: 10.7, discount: 5 },
  { shippingFee: 1.005, discount: 0.335 },
  { shippingFee: 0, discount: 999999 },
];
const AS_ENTERED_VAT: Array<{ vatType: VatType; vatRate: number; inputVatRecoverable: boolean }> = [
  { vatType: "NO_VAT", vatRate: 0, inputVatRecoverable: false },
  { vatType: "NO_VAT", vatRate: 7, inputVatRecoverable: true },
  { vatType: "EXCLUDING_VAT", vatRate: 0, inputVatRecoverable: false },
  { vatType: "EXCLUDING_VAT", vatRate: 7, inputVatRecoverable: true },
  { vatType: "INCLUDING_VAT", vatRate: 7, inputVatRecoverable: false },
  { vatType: "INCLUDING_VAT", vatRate: 0, inputVatRecoverable: true },
];

const sameBits = (actual: number[], expected: number[]): boolean =>
  actual.length === expected.length && actual.every((value, index) => Object.is(value, expected[index]));

test("golden: NO_VAT, recoverable EXCLUDING_VAT and non-recoverable INCLUDING_VAT reproduce the pre-V2 landed cost bit for bit", () => {
  for (const lines of FIXTURE_LINE_SETS) {
    for (const header of FIXTURE_HEADERS) {
      const legacy = legacyAllocateLandedByLineValue(lines, header.shippingFee - header.discount);
      for (const vat of AS_ENTERED_VAT) {
        const input = { lines, ...header, ...vat };
        assert.equal(resolvePurchaseCostingBasis(input), "AS_ENTERED");
        const actual = allocatePurchaseLandedCost(input);
        assert.ok(sameBits(actual, legacy), `${JSON.stringify(input)} → ${JSON.stringify(actual)} ≠ ${JSON.stringify(legacy)}`);
        // Same rows in → same MAVG out.
        const replayNew = replayStockCardMavg(purchaseRows(lines, actual));
        const replayOld = replayStockCardMavg(purchaseRows(lines, legacy));
        assert.deepEqual(replayNew, replayOld);
      }
    }
  }
});

/** Deterministic pseudo-random generator (mulberry32) so the property run is reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROPERTY_RUNS = 20_000;

function randomDocument(random: () => number): Omit<PurchaseInventoryCostInput, "vatType" | "vatRate" | "inputVatRecoverable"> {
  const lineCount = 1 + Math.floor(random() * 6);
  const lines = Array.from({ length: lineCount }, () => ({
    qty: Math.round((0.01 + random() * 50) * 100) / 100,
    costPrice: Math.round(random() * 5000 * 10000) / 10000,
  }));
  return {
    lines,
    shippingFee: random() < 0.5 ? 0 : Math.round(random() * 500 * 100) / 100,
    discount: random() < 0.5 ? 0 : Math.round(random() * 300 * 100) / 100,
  };
}

test(`property: ${PROPERTY_RUNS} random documents — AS_ENTERED equals the frozen pre-V2 allocation`, () => {
  const random = mulberry32(20260930);
  for (let run = 0; run < PROPERTY_RUNS; run += 1) {
    const doc = randomDocument(random);
    const legacy = legacyAllocateLandedByLineValue(doc.lines, doc.shippingFee - doc.discount);
    const vat = AS_ENTERED_VAT[run % AS_ENTERED_VAT.length];
    const actual = allocatePurchaseLandedCost({ ...doc, ...vat });
    assert.ok(sameBits(actual, legacy), `run ${run}: ${JSON.stringify(doc)}`);
  }
});

test(`property: ${PROPERTY_RUNS} random VAT documents — whole satang, Σ lines + Σ landed = pre-VAT subtotal (recoverable INCLUDING) or net (non-recoverable EXCLUDING)`, () => {
  const random = mulberry32(7);
  for (let run = 0; run < PROPERTY_RUNS; run += 1) {
    const doc = randomDocument(random);
    const recoverableIncluding = run % 2 === 0;
    const input: PurchaseInventoryCostInput = {
      ...doc,
      vatType: recoverableIncluding ? "INCLUDING_VAT" : "EXCLUDING_VAT",
      vatRate: run % 3 === 0 ? 10 : 7,
      inputVatRecoverable: recoverableIncluding,
    };
    const landed = allocatePurchaseLandedCost(input);
    const header = computePurchaseHeaderAmounts(input);
    const costBase = recoverableIncluding ? header.subtotalAmount : header.netAmount;
    for (const amount of landed) assert.equal(amount, satang(amount) / 100, `run ${run}: ${amount} is not whole satang`);
    const lineTotalSatang = doc.lines.reduce((sum, line) => sum + D(line.qty).mul(D(line.costPrice)).mul(100).toNumber(), 0);
    const landedSatang = landed.reduce((sum, amount) => sum + satang(amount), 0);
    // Σ exact line values rounds to the satang before the spread, so the identity holds to half a satang.
    assert.ok(
      Math.abs(lineTotalSatang + landedSatang - satang(costBase)) <= 0.5 + 1e-6,
      `run ${run}: ${JSON.stringify(input)}`,
    );
  }
});

// ── Largest remainder ──────────────────────────────────────────────────────────

test("largest remainder: sums exactly, gives leftovers to the largest remainders, ties to the lower index", () => {
  const b = (value: number): bigint => BigInt(value);
  assert.deepEqual(allocateSatangByLargestRemainder(b(100), [b(1), b(1), b(1)]), [b(34), b(33), b(33)]);
  assert.deepEqual(allocateSatangByLargestRemainder(b(-100), [b(1), b(1), b(1)]), [b(-34), b(-33), b(-33)]);
  assert.deepEqual(allocateSatangByLargestRemainder(b(-25963), [b(8), b(1)]), [b(-23078), b(-2885)]);
  assert.deepEqual(allocateSatangByLargestRemainder(b(5), [b(0), b(0)]), [b(0), b(0)]);
  assert.deepEqual(allocateSatangByLargestRemainder(b(0), [b(3), b(4)]), [b(0), b(0)]);
  assert.deepEqual(allocateSatangByLargestRemainder(b(7), [b(0), b(2), b(0)]), [b(0), b(7), b(0)]);
});

// ── The one-time landed-cost script can never undo V2 ─────────────────────────

test("recalculate-purchase-landed-cost.ts uses the central formula and refuses purchases with separate VAT", () => {
  const source = readFileSync(path.join(process.cwd(), "prisma/scripts/recalculate-purchase-landed-cost.ts"), "utf8");
  assert.ok(source.includes('from "../../lib/purchase-inventory-cost"'), "imports the shared formula");
  assert.ok(source.includes("allocatePurchaseLandedCost({"), "allocates through it");
  assert.ok(!/function allocateByLineValue|const roundMoney/.test(source), "no private copy of the allocation");
  assert.ok(source.includes("...WITHOUT_SEPARATE_VAT"), "the rewrite query excludes VAT purchases");
  assert.ok(source.includes('{ OR: [{ vatType: "NO_VAT" }, { vatRate: 0 }] }'), "VAT purchases are only listed");
});
