import type { Prisma } from "@/lib/generated/prisma";
import type { DebitPurchase } from "./DebitForm";

/** Purchase fields the DN form needs; shared by the new and edit pages so both show the same source lines. */
export const debitPurchaseSelect = {
  id: true, purchaseNo: true, vatType: true, vatRate: true, supplier: { select: { name: true } },
  items: { orderBy: { lineNo: "asc" }, select: { id: true, quantity: true, showQty: true,
    showUnitName: true, showPricePerUnit: true, costPrice: true, product: { select: { code: true, name: true } } } },
} satisfies Prisma.PurchaseSelect;

type DebitPurchaseRow = Prisma.PurchaseGetPayload<{ select: typeof debitPurchaseSelect }>;

export const toDebitPurchase = (row: DebitPurchaseRow): DebitPurchase => ({
  id: row.id, purchaseNo: row.purchaseNo, supplierName: row.supplier?.name ?? "", vatType: row.vatType, vatRate: Number(row.vatRate),
  items: row.items.map((item) => ({ id: item.id, productName: item.product.name, productCode: item.product.code,
    quantity: Number(item.showQty ?? item.quantity), unitName: item.showUnitName ?? "หน่วยฐาน",
    price: Number(item.showPricePerUnit ?? item.costPrice) })),
});
