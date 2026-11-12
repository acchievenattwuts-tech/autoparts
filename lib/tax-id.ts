export const TAX_ID_LENGTH = 13;
export const TAX_ID_INVALID_MESSAGE = `เลขผู้เสียภาษีต้องเป็นตัวเลข ${TAX_ID_LENGTH} หลัก`;
export const TAX_ID_MAX_MESSAGE = `เลขผู้เสียภาษีกรอกได้ไม่เกิน ${TAX_ID_LENGTH} หลัก`;
export const TAX_ID_CHECK_DIGIT_MESSAGE = "เลขผู้เสียภาษีไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง";

/** Unicode code point of ๐ (THAI DIGIT ZERO); ๐-๙ are consecutive. */
const THAI_DIGIT_ZERO_CODE_POINT = 0x0e50;
const THAI_DIGIT_PATTERN = /[๐-๙]/g;
/** Thai 13-digit ID check digit: weights 13..2 on digits 1-12, check = (11 - sum mod 11) mod 10. */
const CHECK_DIGIT_FIRST_WEIGHT = 13;
const CHECK_DIGIT_MODULUS = 11;
const DECIMAL_BASE = 10;
const FULL_TAX_ID_PATTERN = new RegExp(`^\\d{${TAX_ID_LENGTH}}$`);

/** ๐-๙ → 0-9; everything else is left as it is. */
export function toAsciiDigits(value: string): string {
  return value.replace(THAI_DIGIT_PATTERN, (digit) => String(digit.charCodeAt(0) - THAI_DIGIT_ZERO_CODE_POINT));
}

/**
 * The digits of a typed tax ID: Thai numerals become 0-9, every other character is removed.
 * Never shortened — a value with more than 13 digits stays longer so it is rejected, not cut.
 */
export function sanitizeTaxId(value: string | null | undefined): string {
  return toAsciiDigits(value ?? "").replace(/\D/g, "");
}

/** True when the 13th digit matches the Thai national / juristic ID check digit. */
export function hasValidThaiTaxIdCheckDigit(digits: string): boolean {
  if (!FULL_TAX_ID_PATTERN.test(digits)) return false;
  const values = [...digits].map(Number);
  const weightedSum = values
    .slice(0, TAX_ID_LENGTH - 1)
    .reduce((sum, digit, index) => sum + digit * (CHECK_DIGIT_FIRST_WEIGHT - index), 0);
  const checkDigit = (CHECK_DIGIT_MODULUS - (weightedSum % CHECK_DIGIT_MODULUS)) % DECIMAL_BASE;
  return checkDigit === values[TAX_ID_LENGTH - 1];
}

/**
 * A stored value saved again unchanged is not re-validated (two production customers, among them
 * the C0001 "ลูกค้าทั่วไป" placeholder, hold 13-digit IDs that fail the check digit). Compared on the
 * digits, so formatting differences do not count as a change.
 */
function isUnchangedStoredTaxId(digits: string, storedTaxId: string | null | undefined): boolean {
  return storedTaxId != null && sanitizeTaxId(storedTaxId) === digits;
}

/**
 * Server-side check-digit rule for a normalised 13-digit value (the Zod schema has already checked
 * the length): returns the Thai message when a new or changed value fails the check digit.
 */
export function getTaxIdCheckDigitError(
  taxId: string | null | undefined,
  storedTaxId: string | null | undefined,
): string | null {
  if (!taxId || isUnchangedStoredTaxId(taxId, storedTaxId)) return null;
  return hasValidThaiTaxIdCheckDigit(taxId) ? null : TAX_ID_CHECK_DIGIT_MESSAGE;
}

export function normalizeOptionalTaxId(
  value: FormDataEntryValue | string | null | undefined,
): string | undefined {
  const raw = typeof value === "string" ? value : value?.toString();
  const sanitized = sanitizeTaxId(raw);
  return sanitized.length > 0 ? sanitized : undefined;
}

/** Browser message for the tax ID field; `storedTaxId` is the saved value of the record being edited. */
export function getTaxIdValidationMessage(
  value: string | null | undefined,
  storedTaxId?: string | null,
): string {
  const rawDigits = sanitizeTaxId(value);
  if (rawDigits.length === 0) return "";
  if (rawDigits.length > TAX_ID_LENGTH) return TAX_ID_MAX_MESSAGE;
  if (rawDigits.length < TAX_ID_LENGTH) return TAX_ID_INVALID_MESSAGE;
  return getTaxIdCheckDigitError(rawDigits, storedTaxId) ?? "";
}
