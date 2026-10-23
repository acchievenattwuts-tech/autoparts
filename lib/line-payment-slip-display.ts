import { PaymentSlipVerificationStatus } from "@/lib/generated/prisma";
import type { PaymentSlipWarningCode } from "@/lib/line-payment-slip-check-rules";

export const paymentSlipStatusLabel: Record<PaymentSlipVerificationStatus, string> = {
  PENDING_REVIEW: "รอตรวจสอบ",
  MATCHED_PENDING_ADMIN_CONFIRM: "รอยืนยัน",
  CONFIRMED_BY_ADMIN: "ยืนยันแล้ว",
  REJECTED: "ปฏิเสธ",
  NEEDS_MORE_INFO: "ขอข้อมูลเพิ่ม",
};

export const paymentSlipStatusBadgeClass: Record<PaymentSlipVerificationStatus, string> = {
  PENDING_REVIEW: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200",
  MATCHED_PENDING_ADMIN_CONFIRM: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200",
  CONFIRMED_BY_ADMIN: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200",
  NEEDS_MORE_INFO: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-slate-300",
};

/** Compact badge per automatic-check warning (slip list rows). */
export const paymentSlipWarningBadge: Record<PaymentSlipWarningCode, { label: string; className: string }> = {
  DUPLICATE_REFERENCE: {
    label: "สลิปซ้ำ",
    className: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200",
  },
  POSSIBLE_DUPLICATE: {
    label: "อาจซ้ำ",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
  },
  RECEIVER_MISMATCH: {
    label: "ผู้รับไม่ตรง",
    className: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200",
  },
};

export function formatPaymentSlipBaht(amount: { toString(): string } | null): string {
  if (amount === null) return "-";
  const value = Number(amount.toString());
  return Number.isFinite(value)
    ? value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "-";
}
