import assert from "node:assert/strict";
import test from "node:test";

import {
  TAX_ID_CHECK_DIGIT_MESSAGE,
  TAX_ID_INVALID_MESSAGE,
  TAX_ID_LENGTH,
  TAX_ID_MAX_MESSAGE,
  getTaxIdCheckDigitError,
  getTaxIdValidationMessage,
  hasValidThaiTaxIdCheckDigit,
  normalizeOptionalTaxId,
  sanitizeTaxId,
  toAsciiDigits,
} from "@/lib/tax-id";

// Characterisation tests for lib/tax-id.ts. Owner decisions applied in review round 3
// (2026-11-12): Thai digits ๐-๙ are converted to 0-9, more than 13 digits is rejected
// instead of cut, and a new or changed 13-digit value must pass the Thai check digit.
// A stored value saved again unchanged is never re-validated.

// The customer and supplier Server Actions validate the normalised value with this
// exact Zod regex (app/admin/(protected)/customers/actions.ts, master/suppliers/actions.ts).
const SERVER_TAX_ID_REGEX = /^\d{13}$/;

/** Independent reference implementation of the mod-11 check digit (weights 13..2). */
const referenceCheckDigit = (first12: string): number => {
  const weighted = [...first12].map(Number).reduce((sum, digit, index) => sum + digit * (13 - index), 0);
  return (11 - (weighted % 11)) % 10;
};

const VALID_CHECK_DIGIT = "1101700207030";
const WRONG_CHECK_DIGIT = "1101700207031";
/** Fails the check digit, like the two stored production customers (C0001 placeholder, C0002). */
const STORED_INVALID = "0000000000000";

test("constants and Thai messages", () => {
  assert.equal(TAX_ID_LENGTH, 13);
  assert.equal(TAX_ID_INVALID_MESSAGE, "เลขผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก");
  assert.equal(TAX_ID_MAX_MESSAGE, "เลขผู้เสียภาษีกรอกได้ไม่เกิน 13 หลัก");
  assert.equal(TAX_ID_CHECK_DIGIT_MESSAGE, "เลขผู้เสียภาษีไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง");
});

test("sanitizeTaxId keeps the digits and never cuts the value", () => {
  assert.equal(sanitizeTaxId(null), "");
  assert.equal(sanitizeTaxId(undefined), "");
  assert.equal(sanitizeTaxId(""), "");
  assert.equal(sanitizeTaxId("0-1055-55123-45-6"), "0105555123456");
  assert.equal(sanitizeTaxId(" 0105555123456 "), "0105555123456");
  assert.equal(sanitizeTaxId("TAX 123"), "123");
  assert.equal(sanitizeTaxId("abc"), "");
  // A 14th digit is kept so the value is rejected, not silently shortened.
  assert.equal(sanitizeTaxId("01055551234567"), "01055551234567");
});

test("Thai digits ๐-๙ are converted to 0-9; full-width digits are still removed", () => {
  assert.equal(toAsciiDigits("๐๑๒๓๔๕๖๗๘๙"), "0123456789");
  assert.equal(toAsciiDigits("เลข ๑๒-๓"), "เลข 12-3");
  assert.equal(sanitizeTaxId("๐๑๐๕๕๕๕๑๒๓๔๕๖"), "0105555123456");
  assert.equal(sanitizeTaxId("๑-๑๐๑๗-๐๐๒๐๗-๐๓-๐"), VALID_CHECK_DIGIT);
  assert.equal(normalizeOptionalTaxId("๑๑๐๑๗๐๐๒๐๗๐๓๐"), VALID_CHECK_DIGIT);
  assert.equal(getTaxIdValidationMessage("๑๑๐๑๗๐๐๒๐๗๐๓๐"), "");
  // Unchanged: full-width digits are not part of the approved change.
  assert.equal(sanitizeTaxId("０１０５５５５１２３４５６"), "");
});

test("normalizeOptionalTaxId returns the sanitised digits or undefined", () => {
  assert.equal(normalizeOptionalTaxId("0105555123456"), "0105555123456");
  assert.equal(normalizeOptionalTaxId("0-1055-55123-45-6"), "0105555123456");
  assert.equal(normalizeOptionalTaxId(null), undefined);
  assert.equal(normalizeOptionalTaxId(undefined), undefined);
  assert.equal(normalizeOptionalTaxId(""), undefined);
  assert.equal(normalizeOptionalTaxId("   "), undefined);
  assert.equal(normalizeOptionalTaxId("--"), undefined);
  // Too short passes through unchanged; the server Zod regex is what rejects it.
  assert.equal(normalizeOptionalTaxId("123"), "123");
  assert.equal(SERVER_TAX_ID_REGEX.test(normalizeOptionalTaxId("123") ?? ""), false);
  // A File entry (FormDataEntryValue) stringifies to "[object File]" -> no digits.
  assert.equal(normalizeOptionalTaxId(new File(["0105555123456"], "tax-id.txt")), undefined);
});

test("a value with more than 13 digits is rejected, never cut to 13", () => {
  const normalised = normalizeOptionalTaxId("01055551234567");
  assert.equal(normalised, "01055551234567");
  assert.equal(SERVER_TAX_ID_REGEX.test(normalised ?? ""), false);
  assert.equal(getTaxIdValidationMessage("01055551234567"), TAX_ID_MAX_MESSAGE);
  assert.equal(getTaxIdValidationMessage("๐๑๐๕๕๕๕๑๒๓๔๕๖๗"), TAX_ID_MAX_MESSAGE);
});

test("getTaxIdValidationMessage counts digits, then checks the check digit", () => {
  assert.equal(getTaxIdValidationMessage(null), "");
  assert.equal(getTaxIdValidationMessage(undefined), "");
  assert.equal(getTaxIdValidationMessage(""), "");
  // No digits at all counts as "empty", so no message.
  assert.equal(getTaxIdValidationMessage("abc"), "");
  assert.equal(getTaxIdValidationMessage("123"), TAX_ID_INVALID_MESSAGE);
  assert.equal(getTaxIdValidationMessage("010555512345"), TAX_ID_INVALID_MESSAGE);
  assert.equal(getTaxIdValidationMessage("1-1017-00207-03-0"), "");
  assert.equal(getTaxIdValidationMessage("0-1055-55123-45-6"), TAX_ID_CHECK_DIGIT_MESSAGE);
  assert.equal(getTaxIdValidationMessage("01055551234567"), TAX_ID_MAX_MESSAGE);
});

test("the Thai check digit: weights 13..2, check = (11 - sum mod 11) mod 10", () => {
  assert.equal(hasValidThaiTaxIdCheckDigit(VALID_CHECK_DIGIT), true);
  assert.equal(hasValidThaiTaxIdCheckDigit(WRONG_CHECK_DIGIT), false);
  assert.equal(hasValidThaiTaxIdCheckDigit(STORED_INVALID), false);
  assert.equal(hasValidThaiTaxIdCheckDigit("110170020703"), false, "12 digits");
  assert.equal(hasValidThaiTaxIdCheckDigit("11017002070300"), false, "14 digits");
  // Every first-12 prefix accepts exactly the reference check digit, incl. sum mod 11 = 0 and 1.
  for (const first12 of ["000000000000", "010555512345", "110170020703", "999999999999", "310010000000", "123456789012"]) {
    const expected = referenceCheckDigit(first12);
    for (let digit = 0; digit <= 9; digit += 1) {
      assert.equal(hasValidThaiTaxIdCheckDigit(`${first12}${digit}`), digit === expected, `${first12}${digit}`);
    }
  }
});

test("a stored tax ID saved again unchanged is accepted even when its check digit is wrong", () => {
  // Server rule (customers / suppliers update): only a new or changed value is checked.
  assert.equal(getTaxIdCheckDigitError(STORED_INVALID, STORED_INVALID), null);
  assert.equal(getTaxIdCheckDigitError(WRONG_CHECK_DIGIT, "1-1017-00207-03-1"), null, "same digits, other format");
  assert.equal(getTaxIdCheckDigitError(WRONG_CHECK_DIGIT, VALID_CHECK_DIGIT), TAX_ID_CHECK_DIGIT_MESSAGE, "changed");
  assert.equal(getTaxIdCheckDigitError(WRONG_CHECK_DIGIT, null), TAX_ID_CHECK_DIGIT_MESSAGE, "new record");
  assert.equal(getTaxIdCheckDigitError(VALID_CHECK_DIGIT, STORED_INVALID), null, "changed to a valid one");
  assert.equal(getTaxIdCheckDigitError(undefined, STORED_INVALID), null, "cleared");
  // Browser: the edit form passes the stored value the same way.
  assert.equal(getTaxIdValidationMessage(STORED_INVALID, STORED_INVALID), "");
  assert.equal(getTaxIdValidationMessage(WRONG_CHECK_DIGIT, STORED_INVALID), TAX_ID_CHECK_DIGIT_MESSAGE);
  // The length rules still apply to an unchanged value (it is always 13 digits when stored by the app).
  assert.equal(getTaxIdValidationMessage("123", "123"), TAX_ID_INVALID_MESSAGE);
});
