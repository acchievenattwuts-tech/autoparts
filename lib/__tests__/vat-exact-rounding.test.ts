import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@/lib/generated/prisma";
import { calcItemSubtotal, calcVat, type VatType } from "@/lib/vat";

// R13: calcVat rounds the document total to the satang, then VAT once half-up with exact
// decimal math, and derives the rest, so net = subtotal + VAT to the satang.

const Decimal = Prisma.Decimal;
const cents = (amount: number): number => Math.round(amount * 100);
const SWEEP_SATANG = 1_000_000; // every total from 0.01 to 10,000.00
const SAMPLE_COUNT = 20_000;
const RATE_7 = BigInt(7); // BigInt() calls, not literals: the TypeScript target is ES2017.

/** Independent BigInt reference: q = floor(n / d), round up when the remainder is at least half. */
function referenceHalfUp(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  return (numerator % denominator) * BigInt(2) >= denominator ? quotient + BigInt(1) : quotient;
}

/** Exact reference on Prisma.Decimal (ROUND_HALF_UP = half away from zero). */
function referenceVat(total: number, vatType: Exclude<VatType, "NO_VAT">, rate: number) {
  const posted = new Decimal(String(total)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const vatRate = new Decimal(String(rate));
  const divisor = vatType === "EXCLUDING_VAT" ? new Decimal(100) : vatRate.plus(100);
  const vat = posted.mul(vatRate).div(divisor).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return vatType === "EXCLUDING_VAT"
    ? { subtotal: posted, vat, net: posted.plus(vat) }
    : { subtotal: posted.minus(vat), vat, net: posted };
}

/** The float formula calcVat used before R13, kept to measure the behavior change. */
function legacyExcludingVat(total: number, rate: number): { vatAmount: number; netAmount: number } {
  const vat = total * rate / 100;
  return { vatAmount: Math.round(vat * 100) / 100, netAmount: Math.round((total + vat) * 100) / 100 };
}

/** Deterministic PRNG (mulberry32) so the sample is the same on every run. */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

test("golden half-satang cases round half-up and keep net = subtotal + VAT", () => {
  assert.deepEqual(calcVat(14.5, "EXCLUDING_VAT", 7), { subtotalAmount: 14.5, vatAmount: 1.02, netAmount: 15.52 });
  assert.deepEqual(calcVat(9.5, "EXCLUDING_VAT", 7), { subtotalAmount: 9.5, vatAmount: 0.67, netAmount: 10.17 });
  assert.deepEqual(calcVat(107, "INCLUDING_VAT", 7), { subtotalAmount: 100, vatAmount: 7, netAmount: 107 });
  // A total with more than two decimals is first rounded to the satang the document stores.
  assert.deepEqual(calcVat(10.705, "INCLUDING_VAT", 7), { subtotalAmount: 10.01, vatAmount: 0.7, netAmount: 10.71 });
  assert.deepEqual(calcVat(1.005, "EXCLUDING_VAT", 7), { subtotalAmount: 1.01, vatAmount: 0.07, netAmount: 1.08 });
});

test("NO_VAT and a zero rate pass the total through unchanged", () => {
  for (const total of [0, 0.01, 14.5, 10.705, 123456.78]) {
    assert.deepEqual(calcVat(total, "NO_VAT", 7), { subtotalAmount: total, vatAmount: 0, netAmount: total });
    assert.deepEqual(calcVat(total, "EXCLUDING_VAT", 0), { subtotalAmount: total, vatAmount: 0, netAmount: total });
    assert.equal(calcItemSubtotal(total, "NO_VAT", 7), total);
    assert.equal(calcItemSubtotal(total, "EXCLUDING_VAT", 7), total);
  }
});

test("invalid input yields NaN instead of throwing", () => {
  assert.ok(Number.isNaN(calcVat(Number.NaN, "EXCLUDING_VAT", 7).vatAmount));
  assert.ok(Number.isNaN(calcVat(100, "INCLUDING_VAT", -100).netAmount));
});

test(`property: every total 0.01-10,000.00 at 7% matches the exact reference (${SWEEP_SATANG} totals)`, () => {
  let excludingMismatches = 0;
  let includingMismatches = 0;
  let unbalanced = 0;
  let changedFromLegacy = 0;
  for (let satang = 1; satang <= SWEEP_SATANG; satang += 1) {
    const total = satang / 100;
    const big = BigInt(satang);
    const excluding = calcVat(total, "EXCLUDING_VAT", 7);
    const excludingVat = referenceHalfUp(big * RATE_7, BigInt(100));
    if (cents(excluding.subtotalAmount) !== satang || BigInt(cents(excluding.vatAmount)) !== excludingVat) {
      excludingMismatches += 1;
    }
    const including = calcVat(total, "INCLUDING_VAT", 7);
    const includingVat = referenceHalfUp(big * RATE_7, BigInt(107));
    if (cents(including.netAmount) !== satang || BigInt(cents(including.vatAmount)) !== includingVat) {
      includingMismatches += 1;
    }
    for (const result of [excluding, including]) {
      if (cents(result.netAmount) !== cents(result.subtotalAmount) + cents(result.vatAmount)) unbalanced += 1;
    }
    const legacy = legacyExcludingVat(total, 7);
    if (legacy.vatAmount !== excluding.vatAmount || legacy.netAmount !== excluding.netAmount) changedFromLegacy += 1;
  }
  assert.equal(excludingMismatches, 0);
  assert.equal(includingMismatches, 0);
  assert.equal(unbalanced, 0);
  // Behavior change vs the float formula: only half-satang EXCLUDING_VAT totals move, by 0.01.
  assert.equal(changedFromLegacy, 1_206);
});

test(`property: ${SAMPLE_COUNT} random totals and rates match Prisma.Decimal half-up`, () => {
  const random = createRandom(20260930);
  const rates = [7, 10, 7.5, 3, 0.5, 1];
  const modes = ["EXCLUDING_VAT", "INCLUDING_VAT"] as const;
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const decimals = Math.floor(random() * 5); // 0-4 decimals, e.g. fractional quantity totals
    const scale = 10 ** decimals;
    const total = Math.floor(random() * 1_000_000 * scale) / scale;
    const rate = rates[index % rates.length];
    const vatType = modes[index % modes.length];
    const actual = calcVat(total, vatType, rate);
    const expected = referenceVat(total, vatType, rate);
    const context = `${vatType} ${total} @ ${rate}%`;
    assert.equal(actual.subtotalAmount, expected.subtotal.toNumber(), context);
    assert.equal(actual.vatAmount, expected.vat.toNumber(), context);
    assert.equal(actual.netAmount, expected.net.toNumber(), context);
    assert.equal(cents(actual.netAmount), cents(actual.subtotalAmount) + cents(actual.vatAmount), context);
    if (vatType === "INCLUDING_VAT") {
      assert.equal(calcItemSubtotal(total, vatType, rate), actual.subtotalAmount, context);
    }
  }
});

test("calcItemSubtotal extracts the inclusive base with the header rule", () => {
  assert.equal(calcItemSubtotal(10.7, "INCLUDING_VAT", 7), 10);
  assert.equal(calcItemSubtotal(0.03, "INCLUDING_VAT", 7), 0.03);
  assert.equal(calcItemSubtotal(1070, "INCLUDING_VAT", 7), 1000);
  // Unchanged from the float formula for every two-decimal total at 7%.
  for (let satang = 1; satang <= 200_000; satang += 1) {
    const total = satang / 100;
    assert.equal(calcItemSubtotal(total, "INCLUDING_VAT", 7), Math.round((total / 1.07) * 100) / 100);
  }
});
