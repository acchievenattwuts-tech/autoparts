import { VAT_TYPE_LABELS, type VatType } from "@/lib/vat";
import type { TaxDocumentVat } from "../purchases/purchase-tax-invoice";

/**
 * Owner decision V3 (2026-09-30): a purchase return that references a purchase uses that
 * purchase's VAT type and rate (the form shows them read-only, the server rejects a mismatch —
 * the same rule as credit notes against their sale) and inherits its input-VAT recoverability.
 * A return without a purchase reference keeps its own VAT fields and its own tax-document date.
 */

const VAT_RATE_TOLERANCE = 0.0001;

export type PurchaseVatBasis = { vatType: VatType; vatRate: number };

/** Thai message when the return's VAT differs from the referenced purchase, else null. */
export function getPurchaseReturnVatMismatchMessage(
  purchase: PurchaseVatBasis & { purchaseNo: string },
  purchaseReturn: PurchaseVatBasis,
): string | null {
  const sameType = purchase.vatType === purchaseReturn.vatType;
  const sameRate =
    purchase.vatType === "NO_VAT" || Math.abs(purchase.vatRate - purchaseReturn.vatRate) <= VAT_RATE_TOLERANCE;
  if (sameType && sameRate) return null;
  const purchaseVatLabel =
    purchase.vatType === "NO_VAT"
      ? VAT_TYPE_LABELS[purchase.vatType]
      : `${VAT_TYPE_LABELS[purchase.vatType]} ${purchase.vatRate}%`;
  return `ภาษีของใบคืนสินค้าต้องตรงกับใบซื้ออ้างอิง ${purchase.purchaseNo} (${purchaseVatLabel})`;
}

/** The document whose VAT and tax-document date decide recoverability: the referenced purchase, else the return. */
export function resolvePurchaseReturnTaxDocument(
  purchaseReturn: TaxDocumentVat,
  referencedPurchase: TaxDocumentVat | null | undefined,
): TaxDocumentVat {
  return referencedPurchase ?? purchaseReturn;
}
