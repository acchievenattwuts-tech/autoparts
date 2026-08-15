import { db } from "./db";
import type { LiffPaymentQrRequest } from "./liff-payment-qr-request";

export type LiffPaymentTarget = {
  amount: number;
  label: string;
};

function toPaymentAmount(value: unknown): number {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

/**
 * Shared by the QR preview, the public image endpoint's caller, and the push-to-chat
 * endpoint so all three always agree on which bills a QR covers and for how much.
 */
export async function resolveLiffPaymentTarget(
  input: LiffPaymentQrRequest,
  customerId: string,
): Promise<LiffPaymentTarget | null> {
  const commonWhere = {
    customerId,
    status: "ACTIVE" as const,
    paymentType: "CREDIT_SALE" as const,
    amountRemain: { gt: 0 },
  };

  if (input.mode === "selected") {
    const sales = await db.sale.findMany({
      where: { ...commonWhere, id: { in: input.saleIds } },
      select: { id: true, amountRemain: true },
    });
    if (sales.length !== input.saleIds.length) return null;

    return {
      amount: toPaymentAmount(sales.reduce((sum, sale) => sum + Number(sale.amountRemain), 0)),
      label: `บิลที่เลือก ${sales.length} บิล`,
    };
  }

  const result = await db.sale.aggregate({
    where: commonWhere,
    _sum: { amountRemain: true },
  });

  return {
    amount: toPaymentAmount(result._sum.amountRemain),
    label: "ยอดค้างชำระทั้งหมด",
  };
}
