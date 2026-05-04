const THAI_MOBILE_PHONE_PATTERN = /^0\d{2}-\d{3}-\d{4}$/;

export const CUSTOMER_PHONE_EXAMPLE = "081-234-5678";

export function formatCustomerPhoneDigits(digits: string) {
  return digits.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
}

export function normalizeCustomerPhone(input: unknown): string | undefined {
  if (input === null || input === undefined) return undefined;

  const raw = String(input).trim();
  if (!raw) return undefined;

  const digits = raw.replace(/\D/g, "");
  const normalizedDigits =
    digits.startsWith("66") && digits.length === 11
      ? `0${digits.slice(2)}`
      : digits.startsWith("0") && digits.length === 10
        ? digits
        : digits.length === 9
          ? `0${digits}`
          : null;

  if (!normalizedDigits || !THAI_MOBILE_PHONE_PATTERN.test(formatCustomerPhoneDigits(normalizedDigits))) {
    throw new Error(`กรุณาระบุเบอร์โทรศัพท์ในรูปแบบ ${CUSTOMER_PHONE_EXAMPLE}`);
  }

  return formatCustomerPhoneDigits(normalizedDigits);
}

export function formatCustomerPhoneInput(input: string) {
  const digits = input.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function buildCustomerPhoneLookupValues(input: string) {
  const formatted = normalizeCustomerPhone(input);
  if (!formatted) return [];

  const digits = formatted.replace(/\D/g, "");
  const noLeadingZero = digits.slice(1);

  return Array.from(
    new Set([
      formatted,
      digits,
      `66${noLeadingZero}`,
      `+66${noLeadingZero}`,
      `+66 ${noLeadingZero}`,
    ]),
  );
}
