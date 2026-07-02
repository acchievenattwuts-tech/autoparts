import type { LotSubRow } from "@/lib/lot-control-client";

export interface SaleFormLineItem {
  productId: string;
  unitName: string;
  qty: number;
  salePrice: number;
  /** Pre-discount list price per unit. salePrice = unitListPrice − lineDiscount/qty. */
  unitListPrice: number;
  /** Total discount amount for this line (baht), for reporting/print only. */
  lineDiscount: number;
  warrantyDays: number;
  supplierId: string;
  supplierName: string;
  moreDetail: string;
  lotItems: LotSubRow[];
}

export type SaleDraftContext =
  | { mode: "new" }
  | { mode: "edit"; saleId: string };

export interface SaleDraftPayload {
  version: 1;
  mode: SaleDraftContext["mode"];
  saleId: string | null;
  updatedAt: string;
  saleDate: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  saleType: string;
  paymentType: "CASH_SALE" | "CREDIT_SALE";
  cashBankAccountId: string;
  fulfillmentType: "PICKUP" | "DELIVERY";
  shippingAddress: string;
  shippingFee: number;
  shippingMethod: string;
  destLatitude: number | null;
  destLongitude: number | null;
  discount: number;
  note: string;
  vatType: string;
  vatRate: number;
  creditTerm: number;
  items: SaleFormLineItem[];
}

export function getSaleDraftKey(context: SaleDraftContext): string {
  return context.mode === "edit"
    ? `sale-draft:edit:${context.saleId}`
    : "sale-draft:new";
}

export function buildSaleDraft(
  input: Omit<SaleDraftPayload, "version" | "updatedAt">,
): SaleDraftPayload {
  return {
    ...input,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
}

export function parseSaleDraft(
  rawValue: string | null,
  context: SaleDraftContext,
): SaleDraftPayload | null {
  if (!rawValue) return null;

  try {
    const parsed = JSON.parse(rawValue) as Partial<SaleDraftPayload>;
    const expectedSaleId = context.mode === "edit" ? context.saleId : null;
    if (
      parsed.version !== 1 ||
      parsed.mode !== context.mode ||
      parsed.saleId !== expectedSaleId ||
      typeof parsed.updatedAt !== "string" ||
      typeof parsed.saleDate !== "string" ||
      typeof parsed.customerId !== "string" ||
      typeof parsed.customerName !== "string" ||
      typeof parsed.customerPhone !== "string" ||
      typeof parsed.saleType !== "string" ||
      (parsed.paymentType !== "CASH_SALE" && parsed.paymentType !== "CREDIT_SALE") ||
      typeof parsed.cashBankAccountId !== "string" ||
      (parsed.fulfillmentType !== "PICKUP" && parsed.fulfillmentType !== "DELIVERY") ||
      typeof parsed.shippingAddress !== "string" ||
      typeof parsed.shippingFee !== "number" ||
      typeof parsed.shippingMethod !== "string" ||
      (parsed.destLatitude !== null && typeof parsed.destLatitude !== "number") ||
      (parsed.destLongitude !== null && typeof parsed.destLongitude !== "number") ||
      typeof parsed.discount !== "number" ||
      typeof parsed.note !== "string" ||
      typeof parsed.vatType !== "string" ||
      typeof parsed.vatRate !== "number" ||
      typeof parsed.creditTerm !== "number" ||
      !Array.isArray(parsed.items)
    ) {
      return null;
    }

    return parsed as SaleDraftPayload;
  } catch {
    return null;
  }
}
