import type { Prisma } from "@/lib/generated/prisma";
import { getVatRegisteredFrom, type InputVatDecisionInput } from "@/lib/input-vat";
import { isDateOnlyString, parseDateOnlyToDate } from "@/lib/th-date";

/**
 * Supplier tax document on purchases and purchase returns (owner decision V5, 2026-09-30).
 *
 * Purchase: "เลขที่ใบกำกับภาษี" + "วันที่ใบกำกับภาษี". Purchase return: the supplier's credit note
 * ("เลขที่ใบลดหนี้ของ supplier" + "วันที่ใบลดหนี้"). Both are required only when the VAT type is not
 * NO_VAT. The date is date-only (.rules §11) and is the tax-document date that decides whether the
 * input VAT is recoverable (lib/input-vat.ts). Shared by the forms (client) and the actions (server).
 */

export const TAX_INVOICE_NO_MAX_LENGTH = 100;

export type TaxInvoiceMessages = {
  numberRequired: string;
  dateRequired: string;
  dateInvalid: string;
  numberTooLong: string;
};

export const PURCHASE_TAX_INVOICE_MESSAGES: TaxInvoiceMessages = {
  numberRequired: "ใบซื้อที่มี VAT ต้องระบุเลขที่ใบกำกับภาษี",
  dateRequired: "ใบซื้อที่มี VAT ต้องระบุวันที่ใบกำกับภาษี",
  dateInvalid: "กรุณาระบุวันที่ใบกำกับภาษีให้ถูกต้อง",
  numberTooLong: `เลขที่ใบกำกับภาษีต้องไม่เกิน ${TAX_INVOICE_NO_MAX_LENGTH} ตัวอักษร`,
};

export const PURCHASE_RETURN_TAX_INVOICE_MESSAGES: TaxInvoiceMessages = {
  numberRequired: "ใบคืนสินค้าที่มี VAT ต้องระบุเลขที่ใบลดหนี้ของ supplier",
  dateRequired: "ใบคืนสินค้าที่มี VAT ต้องระบุวันที่ใบลดหนี้",
  dateInvalid: "กรุณาระบุวันที่ใบลดหนี้ให้ถูกต้อง",
  numberTooLong: `เลขที่ใบลดหนี้ต้องไม่เกิน ${TAX_INVOICE_NO_MAX_LENGTH} ตัวอักษร`,
};

export type TaxInvoiceFields = {
  vatType: string;
  taxInvoiceNo?: string | null;
  taxInvoiceDate?: string | null;
};

/** The first Thai message for the tax-document fields, or null when they are acceptable. */
export function getTaxInvoiceFieldsError(fields: TaxInvoiceFields, messages: TaxInvoiceMessages): string | null {
  const taxInvoiceNo = fields.taxInvoiceNo?.trim() ?? "";
  const taxInvoiceDate = fields.taxInvoiceDate?.trim() ?? "";
  if (taxInvoiceNo.length > TAX_INVOICE_NO_MAX_LENGTH) return messages.numberTooLong;
  if (taxInvoiceDate && !isDateOnlyString(taxInvoiceDate)) return messages.dateInvalid;
  if (fields.vatType === "NO_VAT") return null;
  if (!taxInvoiceNo) return messages.numberRequired;
  if (!taxInvoiceDate) return messages.dateRequired;
  return null;
}

/** "YYYY-MM-DD" (validated) → Date, blank → null. */
export function parseTaxInvoiceDate(value: string | null | undefined): Date | null {
  const trimmed = value?.trim() ?? "";
  return isDateOnlyString(trimmed) ? parseDateOnlyToDate(trimmed) : null;
}

export function normalizeTaxInvoiceNo(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

type AmountLike = number | string | { toString(): string };

export type TaxDocumentVat = {
  vatType: string;
  vatRate: AmountLike;
  taxInvoiceDate: Date | null | undefined;
};

/** The lib/input-vat.ts decision input for a purchase-side document. */
export function toInputVatDecision(doc: TaxDocumentVat, registeredFrom: Date | null): InputVatDecisionInput {
  return {
    vatType: doc.vatType,
    vatRate: Number(doc.vatRate),
    taxDocumentDate: doc.taxInvoiceDate ?? null,
    registeredFrom,
  };
}

const hasSeparateVat = (doc: Pick<TaxDocumentVat, "vatType" | "vatRate">): boolean =>
  doc.vatType !== "NO_VAT" && Number(doc.vatRate) > 0;

/**
 * The VAT registration date, read only when one of `docs` carries VAT (a NO_VAT or zero-rate
 * document is never recoverable, so most purchases skip the read).
 */
export async function loadVatRegisteredFromFor(
  client: Pick<Prisma.TransactionClient, "siteContent">,
  docs: ReadonlyArray<Pick<TaxDocumentVat, "vatType" | "vatRate">>,
): Promise<Date | null> {
  if (!docs.some(hasSeparateVat)) return null;
  try {
    return await getVatRegisteredFrom(client);
  } catch (error) {
    throw new Error("Failed to load the VAT registration date for a purchase document", { cause: error });
  }
}
