import { sameMoney, sameOptional, samePaymentRows, sameQuantity, type ComparablePaymentRow } from "@/lib/period-lock-document";
import { getThailandDateKey } from "@/lib/th-date";

/**
 * Owner decisions ก2 / P4 for purchases: in a month whose profit was already distributed the note,
 * the reference number and each line's detail text (remarks) may change without the override.
 * V5: the tax invoice number and date are remarks too, except a date change that flips whether the
 * input VAT is recoverable (lib/input-vat.ts) — that moves the stock cost, so it is financial.
 * Date, supplier, purchase type, discount, shipping, VAT, credit term, every line (stock signature
 * — product, base qty, cost, lots — plus unit, shown qty and order) and the payment channels are
 * financial.
 */

type Amount = number | string | { toString(): string };

export const PURCHASE_PERIOD_LOCK_ALLOWED_EDITS_HINT =
  "แก้หมายเหตุ เลขที่เอกสารอ้างอิง เลขที่/วันที่ใบกำกับภาษี (ที่ไม่เปลี่ยนสิทธิ์ขอคืน VAT) และรายละเอียดเพิ่มเติมของแต่ละรายการได้โดยไม่ต้องปลดล็อก";

export type PurchaseHeaderState = {
  purchaseDate: Date;
  supplierId: string | null;
  purchaseType: string;
  discount: Amount;
  shippingFee: Amount;
  vatType: string;
  vatRate: Amount;
  /** isInputVatRecoverable() of the document under the current VAT registration date. */
  inputVatRecoverable: boolean;
  creditTerm: number | null;
};

/** `signature` is the stock signature the differential updater already builds for the line. */
export type StoredPurchaseLine = {
  signature: string;
  showQty: Amount | null;
  showUnitName: string | null;
};

export type SubmittedPurchaseLine = {
  signature: string;
  qty: number;
  unitName: string;
};

export function isPurchaseNonFinancialChange(
  stored: PurchaseHeaderState & { lines: StoredPurchaseLine[]; payments: ComparablePaymentRow[] },
  submitted: PurchaseHeaderState & { lines: SubmittedPurchaseLine[]; payments: ComparablePaymentRow[] },
): boolean {
  return (
    getThailandDateKey(stored.purchaseDate) === getThailandDateKey(submitted.purchaseDate) &&
    sameOptional(stored.supplierId, submitted.supplierId) &&
    stored.purchaseType === submitted.purchaseType &&
    sameMoney(stored.discount, submitted.discount) &&
    sameMoney(stored.shippingFee, submitted.shippingFee) &&
    stored.vatType === submitted.vatType &&
    sameMoney(stored.vatRate, submitted.vatRate) &&
    stored.inputVatRecoverable === submitted.inputVatRecoverable &&
    (stored.creditTerm ?? null) === (submitted.creditTerm ?? null) &&
    stored.lines.length === submitted.lines.length &&
    stored.lines.every((line, index) => {
      const next = submitted.lines[index];
      // moreDetail is a remark (P4) and the reference number is not compared at all.
      return (
        line.signature === next.signature &&
        (line.showQty === null || sameQuantity(line.showQty, next.qty)) &&
        (line.showUnitName === null || line.showUnitName === next.unitName)
      );
    }) &&
    samePaymentRows(stored.payments, submitted.payments)
  );
}
