import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import {
  formatSaleQuantity,
  hasAtMostDecimalPlaces,
  isFractionalSaleQuantity,
  toSaleBaseQuantity,
} from "@/lib/sale-quantity";

// E7 display rule: integers exactly as before, a fractional line with exactly 2 decimals.

test("formats integers without decimals and fractional lines with exactly 2 decimals", () => {
  assert.equal(formatSaleQuantity(1), "1");
  assert.equal(formatSaleQuantity(12), "12");
  assert.equal(formatSaleQuantity(0.4), "0.40");
  assert.equal(formatSaleQuantity(1.25), "1.25");
  assert.equal(formatSaleQuantity(-0.4), "-0.40");
  assert.equal(formatSaleQuantity(-2), "-2");
});

test("thousands separators match the existing toLocaleString(\"th-TH\") quantity display", () => {
  assert.equal(formatSaleQuantity(1000), "1,000");
  assert.equal(formatSaleQuantity(1234.5), "1,234.50");
  assert.equal(formatSaleQuantity(1000, { useGrouping: false }), "1000");
  assert.equal(formatSaleQuantity(1234.5, { useGrouping: false }), "1234.50");
});

test("integer output is byte-identical to the pre-E7 formatters", () => {
  for (const quantity of [0, 1, 2, 7, 12, 99, 100, 999, 1000, 12345, 1_000_000, -1, -15]) {
    assert.equal(formatSaleQuantity(quantity), quantity.toLocaleString("th-TH"));
    assert.equal(formatSaleQuantity(quantity), quantity.toLocaleString("th-TH", { maximumFractionDigits: 4 }));
    assert.equal(formatSaleQuantity(quantity, { useGrouping: false }), `${quantity}`);
  }
  // A display quantity rebuilt as base / scale carries float noise; it still prints as an integer.
  assert.equal(formatSaleQuantity(0.1 * 3 * 10), "3");
  assert.equal(formatSaleQuantity(2.9999999999), (2.9999999999).toLocaleString("th-TH"));
});

test("accepts Prisma Decimals and numeric strings from Decimal(12,4) columns", () => {
  assert.equal(formatSaleQuantity(new Prisma.Decimal("3.0000")), "3");
  assert.equal(formatSaleQuantity(new Prisma.Decimal("0.4000")), "0.40");
  assert.equal(formatSaleQuantity("1250.0000"), "1,250");
  assert.equal(isFractionalSaleQuantity(new Prisma.Decimal("2")), false);
  assert.equal(isFractionalSaleQuantity(new Prisma.Decimal("0.25")), true);
});

test("decimal-place checks tolerate float noise but reject real extra digits", () => {
  assert.equal(hasAtMostDecimalPlaces(0.29, 2), true);
  assert.equal(hasAtMostDecimalPlaces(0.1 * 3, 2), true);
  assert.equal(hasAtMostDecimalPlaces(12345678.12, 2), true);
  assert.equal(hasAtMostDecimalPlaces(0.125, 2), false);
  assert.equal(hasAtMostDecimalPlaces(1.005, 2), false);
  assert.equal(hasAtMostDecimalPlaces(Number.NaN, 2), false);
  assert.equal(hasAtMostDecimalPlaces(Number.POSITIVE_INFINITY, 2), false);
});

test("base quantity keeps up to 4 decimals instead of rounding to an integer", () => {
  assert.equal(toSaleBaseQuantity(0.4, 1), 0.4);
  assert.equal(toSaleBaseQuantity(0.1, 3), 0.3);
  assert.equal(toSaleBaseQuantity(1.5, 1), 1.5);
  assert.equal(toSaleBaseQuantity(0.25, 12), 3);
  assert.equal(toSaleBaseQuantity(2, 12), 24);
  assert.equal(toSaleBaseQuantity(0.33, 0.5), 0.165);
  // 0.01 x 0.3333 = 0.003333 would be rounded by the Decimal(12,4) column: refused instead.
  assert.equal(toSaleBaseQuantity(0.01, 0.3333), null);
});
