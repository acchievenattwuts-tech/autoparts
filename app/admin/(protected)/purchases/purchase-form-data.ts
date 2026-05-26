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
