import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateWhtTax,
  parseWhtReceivedField,
  resolveCashAmount,
  toThaiTaxHalf,
  toThaiTaxMonth,
  toThaiTaxYear,
  validateWhtAgainstTotal,
} from "@/lib/wht";

test("toThaiTaxYear converts to the Buddhist era used by every ภ.ง.ด. form", () => {
  assert.equal(toThaiTaxYear(new Date("2026-09-07T03:00:00.000Z")), 2569);
  // 31 ธ.ค. 23:30 UTC คือ 1 ม.ค. ตามเวลาไทย — ปีภาษีต้องเดินไปปีถัดไปแล้ว
  assert.equal(toThaiTaxYear(new Date("2026-12-31T23:30:00.000Z")), 2570);
});

test("toThaiTaxMonth and toThaiTaxHalf follow the Thailand calendar day", () => {
  assert.equal(toThaiTaxMonth(new Date("2026-06-30T20:00:00.000Z")), 7);
  assert.equal(toThaiTaxHalf(new Date("2026-06-30T20:00:00.000Z")), 2);
  assert.equal(toThaiTaxHalf(new Date("2026-06-30T10:00:00.000Z")), 1);
  assert.equal(toThaiTaxHalf(new Date("2026-01-01T03:00:00.000Z")), 1);
});

test("calculateWhtTax rounds to satang", () => {
  assert.equal(calculateWhtTax(1000, 3), 30);
  assert.equal(calculateWhtTax(333.33, 3), 10);
  assert.equal(calculateWhtTax(1234.56, 1), 12.35);
});

test("resolveCashAmount leaves the receivable intact and reduces only the cash", () => {
  assert.equal(resolveCashAmount(10700, 300), 10400);
  assert.equal(resolveCashAmount(100, 100), 0);
});

test("parseWhtReceivedField treats blank input as no withholding", () => {
  for (const raw of ["", "null", null]) {
    const result = parseWhtReceivedField(raw);
    assert.equal(result.success, true);
    assert.equal(result.success && result.data, null);
  }
});

test("parseWhtReceivedField rejects a zero tax amount", () => {
  const result = parseWhtReceivedField(
    JSON.stringify({ incomeTypeId: "type_1", baseAmount: 1000, rate: 3, taxAmount: 0 }),
  );
  assert.equal(result.success, false);
});

test("parseWhtReceivedField normalises optional certificate fields", () => {
  const result = parseWhtReceivedField(
    JSON.stringify({
      incomeTypeId: "type_1",
      baseAmount: 1000,
      rate: 3,
      taxAmount: 30.004,
      certNo: "  ",
      certDate: null,
    }),
  );
  assert.equal(result.success, true);
  if (!result.success || !result.data) throw new Error("expected parsed data");
  assert.equal(result.data.taxAmount, 30);
  assert.equal(result.data.certNo, null);
  assert.equal(result.data.certDate, null);
});

test("validateWhtAgainstTotal guards the amounts a receipt can carry", () => {
  const wht = {
    incomeTypeId: "type_1",
    baseAmount: 1000,
    rate: 3,
    taxAmount: 30,
    certNo: null,
    certDate: null,
  };

  assert.equal(validateWhtAgainstTotal(null, 0, { hasCustomer: false }), null);
  assert.equal(validateWhtAgainstTotal(wht, 1000, { hasCustomer: true }), null);
  assert.notEqual(validateWhtAgainstTotal(wht, 0, { hasCustomer: true }), null);
  assert.notEqual(validateWhtAgainstTotal(wht, 1000, { hasCustomer: false }), null);
  assert.notEqual(
    validateWhtAgainstTotal({ ...wht, taxAmount: 1500 }, 1000, { hasCustomer: true }),
    null,
  );
  assert.notEqual(
    validateWhtAgainstTotal({ ...wht, baseAmount: 1500 }, 1000, { hasCustomer: true }),
    null,
  );
});
