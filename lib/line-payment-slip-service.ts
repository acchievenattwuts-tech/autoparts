import { PaymentSlipVerificationStatus } from "@/lib/generated/prisma";
import { THAILAND_UTC_OFFSET } from "@/lib/th-date";

export function getInitialPaymentSlipStatus() {
  return PaymentSlipVerificationStatus.PENDING_REVIEW;
}

export function canConfirmPaymentSlip(status: PaymentSlipVerificationStatus) {
  return status === PaymentSlipVerificationStatus.MATCHED_PENDING_ADMIN_CONFIRM;
}

/**
 * Advisory OCR fields extracted from a payment-slip image. These are review aids
 * only — they never confirm a payment or mutate receipt/AR truth on their own.
 */
export type PaymentSlipOcr = {
  amount: number | null;
  transferDatetimeIso: string | null;
  bank: string | null;
  senderName: string | null;
  receiverName: string | null;
  referenceNo: string | null;
  rawText: string | null;
};

export const EMPTY_PAYMENT_SLIP_OCR: PaymentSlipOcr = {
  amount: null,
  transferDatetimeIso: null,
  bank: null,
  senderName: null,
  receiverName: null,
  referenceNo: null,
  rawText: null,
};

function cleanString(value: unknown, maxLength = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function cleanAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value * 100) / 100;
  }
  if (typeof value === "string") {
    const numeric = Number.parseFloat(value.replace(/[, ฿]/g, ""));
    if (Number.isFinite(numeric) && numeric >= 0) {
      return Math.round(numeric * 100) / 100;
    }
  }
  return null;
}

function cleanSlipTransferDatetime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (match) {
    const [, rawYear, month, day, hour, minute, second = "00"] = match;
    const year = Number(rawYear);
    const normalizedYear = year > 2400 ? year - 543 : year;
    const parsed = new Date(
      `${String(normalizedYear).padStart(4, "0")}-${month}-${day}T${hour}:${minute}:${second}${THAILAND_UTC_OFFSET}`,
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function extractJson(text: string): string | null {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : null;
}

/**
 * Parses the Gemini OCR JSON response into normalized advisory fields. Always
 * returns a value (empty fields on any parse failure) — never throws.
 */
export function parsePaymentSlipOcr(raw: string): PaymentSlipOcr {
  const jsonText = extractJson(raw);
  if (!jsonText) return EMPTY_PAYMENT_SLIP_OCR;

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    return {
      amount: cleanAmount(parsed.amount),
      transferDatetimeIso: cleanSlipTransferDatetime(parsed.transferDatetime),
      bank: cleanString(parsed.bank, 80),
      senderName: cleanString(parsed.senderName, 120),
      receiverName: cleanString(parsed.receiverName, 120),
      referenceNo: cleanString(parsed.referenceNo, 80),
      rawText: cleanString(parsed.rawText, 1000),
    };
  } catch {
    return EMPTY_PAYMENT_SLIP_OCR;
  }
}
