export type VatType = "NO_VAT" | "EXCLUDING_VAT" | "INCLUDING_VAT";

export interface VatResult {
  subtotalAmount: number; // ยอดก่อนภาษี (หลังส่วนลด)
  vatAmount:      number; // ยอดภาษี
  netAmount:      number; // ยอดสุทธิ (ที่จ่ายจริง)
}

/**
 * Calculate VAT from a discounted total
 * @param discountedTotal - total after discount, before VAT adjustment
 * @param vatType - VAT type
 * @param vatRate - VAT rate as percentage (e.g. 7 for 7%)
 */
export function calcVat(
  discountedTotal: number,
  vatType: VatType,
  vatRate: number
): VatResult {
  if (vatType === "NO_VAT" || vatRate === 0) {
    return {
      subtotalAmount: discountedTotal,
      vatAmount:      0,
      netAmount:      discountedTotal,
    };
  }
  if (vatType === "EXCLUDING_VAT") {
    const vatAmount = discountedTotal * vatRate / 100;
    return {
      subtotalAmount: discountedTotal,
      vatAmount:      Math.round(vatAmount * 100) / 100,
      netAmount:      Math.round((discountedTotal + vatAmount) * 100) / 100,
    };
  }
  // INCLUDING_VAT
  const vatAmount = discountedTotal * vatRate / (100 + vatRate);
  return {
    subtotalAmount: Math.round((discountedTotal - vatAmount) * 100) / 100,
    vatAmount:      Math.round(vatAmount * 100) / 100,
    netAmount:      discountedTotal,
  };
}

/**
 * Calculate item-level subtotalAmount (before tax)
 */
export function calcItemSubtotal(
  itemTotal: number,
  vatType: VatType,
  vatRate: number
): number {
  if (vatType === "INCLUDING_VAT" && vatRate > 0) {
    return Math.round(itemTotal * 100 / (100 + vatRate)) / 100;
  }
  return itemTotal; // NO_VAT or EXCLUDING_VAT: entered price is already pre-tax
}

export const VAT_TYPE_LABELS: Record<VatType, string> = {
  NO_VAT:        "ไม่มีภาษี",
  EXCLUDING_VAT: "ราคาไม่รวม VAT",
  INCLUDING_VAT: "ราคารวม VAT",
};
