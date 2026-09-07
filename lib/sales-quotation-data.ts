import type { Prisma } from "./generated/prisma";
import { formatDateOnlyForInput } from "./th-date";
import type { QuotationData } from "./sales-quotation-form";

export const quotationToFormData = (quote: Prisma.SalesQuotationGetPayload<{ include: { items: true } }>): QuotationData => ({
  quotationDate: formatDateOnlyForInput(quote.quotationDate), customerId: quote.customerId, customerName: quote.customerName,
  customerPhone: quote.customerPhone ?? "", customerAddress: quote.customerAddress ?? "", creditTerm: quote.creditTerm,
  saleType: quote.saleType, discount: Number(quote.discount), note: quote.note ?? "", vatType: quote.vatType, vatRate: Number(quote.vatRate),
  items: [...quote.items].sort((a, b) => a.lineNo - b.lineNo).map((row) => ({ productId: row.productId, unitName: row.showUnitName, qty: Number(row.showQty), salePrice: Number(row.salePrice), unitListPrice: Number(row.unitListPrice), moreDetail: row.moreDetail ?? "", priceListId: row.priceListId, pricePromotionId: row.pricePromotionId })),
});
