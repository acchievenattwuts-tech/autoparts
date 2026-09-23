import type { PurchaseType } from "@/lib/generated/prisma";

// Display-only payment status for a purchase (AP side), derived from the stored
// amountRemain the same way lib/amount-remain.ts resolves Purchase.paymentStatus,
// so the badge always agrees with the "ยอดค้างชำระ" amount shown next to it.
export type PurchasePaymentDisplayStatus = "PAID" | "PARTIALLY_PAID" | "UNPAID";

export const PURCHASE_PAYMENT_STATUS_LABEL: Record<PurchasePaymentDisplayStatus, string> = {
  PAID: "ชำระแล้ว",
  PARTIALLY_PAID: "ชำระบางส่วน",
  UNPAID: "ค้างชำระ",
};

export const PURCHASE_PAYMENT_STATUS_TONE = {
  PAID: "success",
  PARTIALLY_PAID: "warning",
  UNPAID: "danger",
} as const satisfies Record<PurchasePaymentDisplayStatus, string>;

export const getPurchasePaymentDisplayStatus = (
  purchaseType: PurchaseType,
  netAmount: number,
  amountRemain: number,
): PurchasePaymentDisplayStatus => {
  if (purchaseType === "CASH_PURCHASE") return "PAID";
  if (amountRemain <= 0) return "PAID";
  if (amountRemain < netAmount) return "PARTIALLY_PAID";
  return "UNPAID";
};
