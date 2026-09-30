import type { Prisma, VatType } from "@/lib/generated/prisma";
import { formatDateThai, getThailandDateKey, isDateOnlyString, parseDateOnlyToDate } from "@/lib/th-date";

/**
 * Input VAT policy (owner decision 2026-09-30, review V1 = option ข).
 *
 * Input VAT on a purchase-side document is RECOVERABLE (kept out of product cost / expense and reported
 * as input tax) only when both hold:
 *   1. the document uses a VAT type other than NO_VAT with a positive rate, and
 *   2. the shop was VAT-registered on the document's tax-invoice date, i.e. the company setting
 *      `vat_registered_from` (YYYY-MM-DD, Thailand date) is set and is on or before that date.
 * Otherwise every baht paid, VAT included, is cost. Before registration this lets staff key supplier
 * invoices exactly as printed (EXCLUDING/INCLUDING VAT) while cost still includes the VAT, and it matches
 * SAP / Business Central / Odoo, where recoverability follows the company's tax setup rather than the
 * price-entry mode (TAS 2 para 11: only non-recoverable taxes are part of inventory cost).
 *
 * The tax document date is: Purchase / Expense / PurchaseReturn `taxInvoiceDate`; Supplier DN `debitDate`
 * (the supplier's own tax document). DN adjustments and purchase returns that reference a source
 * document inherit the source's VAT type, rate and recoverability (review V3).
 */

export const VAT_REGISTERED_FROM_KEY = "vat_registered_from";

type SiteContentReader = Pick<Prisma.TransactionClient, "siteContent">;

export type InputVatDecisionInput = {
  vatType: VatType | string;
  vatRate: number;
  taxDocumentDate: Date | null | undefined;
  registeredFrom: Date | null;
};

/** "YYYY-MM-DD" (Thailand date) → Date, blank or malformed → null (not registered). */
export function parseVatRegisteredFrom(value: string | null | undefined): Date | null {
  const trimmed = value?.trim() ?? "";
  return isDateOnlyString(trimmed) ? parseDateOnlyToDate(trimmed) : null;
}

/** The shop's VAT registration date, or null while it is not VAT-registered. */
export async function getVatRegisteredFrom(client: SiteContentReader): Promise<Date | null> {
  try {
    const row = await client.siteContent.findUnique({ where: { key: VAT_REGISTERED_FROM_KEY }, select: { value: true } });
    return parseVatRegisteredFrom(row?.value);
  } catch (error) {
    throw new Error("Failed to read the VAT registration date", { cause: error });
  }
}

export function isInputVatRecoverable(input: InputVatDecisionInput): boolean {
  if (input.vatType === "NO_VAT" || !(Number(input.vatRate) > 0)) return false;
  if (!input.registeredFrom || !input.taxDocumentDate) return false;
  return getThailandDateKey(input.taxDocumentDate) >= getThailandDateKey(input.registeredFrom);
}

/** One-line Thai explanation shown next to VAT fields and in document details. */
export function describeInputVatTreatment(input: InputVatDecisionInput): string {
  if (input.vatType === "NO_VAT" || !(Number(input.vatRate) > 0)) return "ไม่มี VAT แยก: ยอดทั้งหมดเป็นต้นทุน";
  if (isInputVatRecoverable(input)) {
    return `ร้านจดทะเบียน VAT แล้ว (ตั้งแต่ ${formatDateThai(input.registeredFrom as Date)}): VAT เป็นภาษีซื้อ ไม่รวมในต้นทุน`;
  }
  if (!input.registeredFrom) return "ร้านยังไม่ได้จดทะเบียน VAT: VAT รวมเป็นต้นทุนทั้งจำนวน";
  if (!input.taxDocumentDate) return "ยังไม่ได้ระบุวันที่ใบกำกับภาษี: VAT รวมเป็นต้นทุนไว้ก่อน";
  return `วันที่ใบกำกับภาษีก่อนวันจดทะเบียน VAT (${formatDateThai(input.registeredFrom)}): VAT รวมเป็นต้นทุนทั้งจำนวน`;
}
