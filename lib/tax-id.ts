export const TAX_ID_LENGTH = 13;
export const TAX_ID_INVALID_MESSAGE = `เลขผู้เสียภาษีต้องเป็นตัวเลข ${TAX_ID_LENGTH} หลัก`;
export const TAX_ID_MAX_MESSAGE = `เลขผู้เสียภาษีกรอกได้ไม่เกิน ${TAX_ID_LENGTH} หลัก`;

export function sanitizeTaxId(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "").slice(0, TAX_ID_LENGTH);
}

export function normalizeOptionalTaxId(
  value: FormDataEntryValue | string | null | undefined,
): string | undefined {
  const raw = typeof value === "string" ? value : value?.toString();
  const sanitized = sanitizeTaxId(raw);
  return sanitized.length > 0 ? sanitized : undefined;
}

export function getTaxIdValidationMessage(value: string | null | undefined): string {
  const rawDigits = (value ?? "").replace(/\D/g, "");
  if (rawDigits.length === 0) return "";
  if (rawDigits.length > TAX_ID_LENGTH) return TAX_ID_MAX_MESSAGE;
  if (rawDigits.length < TAX_ID_LENGTH) return TAX_ID_INVALID_MESSAGE;
  return "";
}
