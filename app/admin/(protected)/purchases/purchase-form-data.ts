export interface PurchaseFormLotItem {
  lotNo: string;
  qty: number;
  unitCost: number;
  mfgDate: string;
  expDate: string;
}

export interface PurchaseFormLineItem {
  productId: string;
  unitName: string;
  qty: number;
  costPrice: number;
  landedCost: number;
  lotItems: PurchaseFormLotItem[];
}

export type PurchaseDraftContext =
  | { mode: "new" }
  | { mode: "edit"; purchaseId: string };

export interface PurchaseDraftPayload {
  version: 1;
  mode: PurchaseDraftContext["mode"];
  purchaseId: string | null;
  updatedAt: string;
  purchaseDate: string;
  supplierId: string;
  purchaseType: string;
  cashBankAccountId: string;
  referenceNo: string;
  discount: number;
  shippingFee: number;
  note: string;
  vatType: string;
  vatRate: number;
  creditTerm: string;
  items: PurchaseFormLineItem[];
}

export function sanitizePurchaseItemsForSubmit(
  items: PurchaseFormLineItem[],
): PurchaseFormLineItem[] {
  return items.map((item) => ({
    ...item,
    // Server recomputes landed cost from shipping/discount, so clamp persisted
    // negative allocations here to avoid edit-form validation failures.
    landedCost: Math.max(0, item.landedCost || 0),
  }));
}

export function getPurchaseDraftKey(context: PurchaseDraftContext): string {
  return context.mode === "edit"
    ? `purchase-draft:edit:${context.purchaseId}`
    : "purchase-draft:new";
}

export function buildPurchaseDraft(
  input: Omit<PurchaseDraftPayload, "version" | "updatedAt">,
): PurchaseDraftPayload {
  return {
    ...input,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
}

export function parsePurchaseDraft(
  rawValue: string | null,
  context: PurchaseDraftContext,
): PurchaseDraftPayload | null {
  if (!rawValue) return null;

  try {
    const parsed = JSON.parse(rawValue) as Partial<PurchaseDraftPayload>;
    const expectedPurchaseId = context.mode === "edit" ? context.purchaseId : null;
    if (
      parsed.version !== 1 ||
      parsed.mode !== context.mode ||
      parsed.purchaseId !== expectedPurchaseId ||
      typeof parsed.updatedAt !== "string" ||
      typeof parsed.purchaseDate !== "string" ||
      typeof parsed.supplierId !== "string" ||
      typeof parsed.purchaseType !== "string" ||
      typeof parsed.cashBankAccountId !== "string" ||
      typeof parsed.referenceNo !== "string" ||
      typeof parsed.discount !== "number" ||
      typeof parsed.shippingFee !== "number" ||
      typeof parsed.note !== "string" ||
      typeof parsed.vatType !== "string" ||
      typeof parsed.vatRate !== "number" ||
      typeof parsed.creditTerm !== "string" ||
      !Array.isArray(parsed.items)
    ) {
      return null;
    }

    return parsed as PurchaseDraftPayload;
  } catch {
    return null;
  }
}
