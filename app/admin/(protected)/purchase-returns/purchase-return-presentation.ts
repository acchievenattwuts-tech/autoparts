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
