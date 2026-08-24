export const MANUAL_SHOPEE_SHOP_ID = "manual-primary";

export const SHOPEE_SETTLEMENT_FEE_OPTIONS = [
  { code: "COMMISSION", label: "ค่าคอมมิชชัน" },
  { code: "SERVICE", label: "ค่าบริการ" },
  { code: "PAYMENT", label: "ค่าธรรมเนียมการชำระเงิน" },
  { code: "PROGRAM", label: "ค่าธรรมเนียมโปรแกรม/แคมเปญ" },
  { code: "SHIPPING", label: "ส่วนต่างค่าจัดส่ง" },
  { code: "OTHER", label: "รายการอื่น" },
] as const;

export function calculateShopeeSettlement(
  salesAmount: number,
  feeAmounts: number[],
  payoutAmount: number,
) {
  const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const feeAmount = round2(feeAmounts.reduce((sum, value) => sum + value, 0));
  const expectedPayout = round2(salesAmount - feeAmount);
  return {
    salesAmount: round2(salesAmount),
    feeAmount,
    expectedPayout,
    difference: round2(payoutAmount - expectedPayout),
  };
}
