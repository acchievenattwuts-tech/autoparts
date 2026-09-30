export type PurchaseReturnSettlementType = "CASH_REFUND" | "SUPPLIER_CREDIT";

/** Thai label for each settlement type — the same wording as the form's toggle buttons. */
export const PURCHASE_RETURN_SETTLEMENT_LABELS: Record<PurchaseReturnSettlementType, string> = {
  CASH_REFUND: "รับเงินคืน",
  SUPPLIER_CREDIT: "เครดิตซัพพลายเออร์",
};

/**
 * Only a supplier-credit return carries a balance to offset against later supplier
 * payments; a cash refund is settled on the spot and its amountRemain is always 0.
 */
export const hasPurchaseReturnSupplierCredit = (settlementType: PurchaseReturnSettlementType): boolean =>
  settlementType === "SUPPLIER_CREDIT";

/**
 * X3 (owner 2026-09-30): an edit may switch DISCOUNT ↔ OTHER but never RETURN ↔ DISCOUNT/OTHER — a RETURN holds
 * RETURN_OUT stock rows, a DISCOUNT/OTHER return ลดราคาซื้อ rows. updatePurchaseReturn rejects the switch and the edit
 * form disables those options, both from this rule and message.
 */
export const isPurchaseReturnTypeChangeAllowed = (storedType: string, nextType: string): boolean =>
  (storedType === "RETURN") === (nextType === "RETURN");

export const PURCHASE_RETURN_TYPE_CHANGE_MESSAGE =
  "เปลี่ยนประเภทการคืนระหว่าง \"ส่งคืนสินค้า\" กับ \"ส่วนลดราคา/อื่นๆ\" ไม่ได้ กรุณายกเลิกเอกสารนี้แล้วบันทึกเอกสารใหม่";
