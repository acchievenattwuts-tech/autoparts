import { sameMoney, sameOptional, samePaymentRows, sameQuantity, type ComparablePaymentRow } from "@/lib/period-lock-document";
import { getThailandDateKey } from "@/lib/th-date";

/**
 * Owner decisions ก2 / P4 for purchase returns: in a month whose profit was already distributed the
 * note and each line's detail text (a remark) may change without the override. V5: the supplier
 * credit-note number and date are remarks too, except a date change that flips whether the input
 * VAT is recoverable (lib/input-vat.ts). Date, source purchase, claim, supplier, type, settlement,
 * VAT, every line (stock signature — product, base qty, cost, lots — plus unit, shown qty and
 * order) and the refund channels are financial.
 */

type Amount = number | string | { toString(): string };

export const PURCHASE_RETURN_PERIOD_LOCK_ALLOWED_EDITS_HINT =
  "แก้หมายเหตุ เลขที่/วันที่ใบลดหนี้ของ supplier (ที่ไม่เปลี่ยนสิทธิ์ขอคืน VAT) และรายละเอียดเพิ่มเติมของแต่ละรายการได้โดยไม่ต้องปลดล็อก";

export type PurchaseReturnHeaderState = {
  returnDate: Date;
  purchaseId: string | null;
  claimId: string | null;
  supplierId: string | null;
  type: string;
  settlementType: string;
  vatType: string;
  vatRate: Amount;
  /** isInputVatRecoverable() of the return (inherited from its purchase when referenced). */
  inputVatRecoverable: boolean;
};

/** `signature` is the stock signature the differential updater builds for the line. */
export type PurchaseReturnLineState = {
  signature: string;
  showQty: Amount | null;
  showUnitName: string | null;
};

export function isPurchaseReturnNonFinancialChange(
  stored: PurchaseReturnHeaderState & { lines: PurchaseReturnLineState[]; payments: ComparablePaymentRow[] },
  submitted: PurchaseReturnHeaderState & { lines: PurchaseReturnLineState[]; payments: ComparablePaymentRow[] },
): boolean {
  return (
    getThailandDateKey(stored.returnDate) === getThailandDateKey(submitted.returnDate) &&
    sameOptional(stored.purchaseId, submitted.purchaseId) &&
    sameOptional(stored.claimId, submitted.claimId) &&
    sameOptional(stored.supplierId, submitted.supplierId) &&
    stored.type === submitted.type &&
    stored.settlementType === submitted.settlementType &&
    stored.vatType === submitted.vatType &&
    sameMoney(stored.vatRate, submitted.vatRate) &&
    stored.inputVatRecoverable === submitted.inputVatRecoverable &&
    stored.lines.length === submitted.lines.length &&
    stored.lines.every((line, index) => {
      const next = submitted.lines[index];
      // moreDetail is a remark (P4): not compared.
      return (
        line.signature === next.signature &&
        (line.showQty === null || next.showQty === null || sameQuantity(line.showQty, next.showQty)) &&
        (line.showUnitName === null || line.showUnitName === next.showUnitName)
      );
    }) &&
    samePaymentRows(stored.payments, submitted.payments)
  );
}
