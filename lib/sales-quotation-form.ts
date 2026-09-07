import { z } from "zod";
import { getThailandDateKey, parseDateOnlyToDate } from "@/lib/th-date";
import { calcVat } from "@/lib/vat";

const money = z.coerce.number().finite().min(0).max(99999999.99);
export const quotationSchema = z.object({
  quotationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    try { return getThailandDateKey(parseDateOnlyToDate(value)) === value; } catch { return false; }
  }, "วันที่ไม่ถูกต้อง"),
  customerId: z.string().min(1, "กรุณาเลือกลูกค้า").max(50),
  customerName: z.string().trim().min(1, "กรุณาระบุชื่อลูกค้า").max(100),
  customerPhone: z.string().max(20).default(""),
  customerAddress: z.string().max(500).default(""),
  creditTerm: z.coerce.number().int().min(0).max(365),
  saleType: z.enum(["WHOLESALE", "RETAIL"]).default("RETAIL"),
  discount: money,
  note: z.string().max(2000).default(""),
  vatType: z.enum(["NO_VAT", "INCLUDING_VAT", "EXCLUDING_VAT"]),
  vatRate: z.coerce.number().finite().min(0).max(100),
  items: z.array(z.object({
    productId: z.string().min(1).max(50),
    unitName: z.string().min(1).max(50),
    qty: z.coerce.number().finite().positive().max(99999999),
    salePrice: money,
    unitListPrice: money,
    moreDetail: z.string().max(500).default(""),
    priceListId: z.string().max(50).nullable().optional(),
    pricePromotionId: z.string().max(50).nullable().optional(),
  })).min(1, "กรุณาเพิ่มสินค้า").max(200),
});
export type QuotationInput = z.input<typeof quotationSchema>;
export type QuotationData = z.output<typeof quotationSchema>;

export const quotationTotals = (input: Pick<QuotationData, "items" | "discount" | "vatType" | "vatRate">) => {
  const totalAmount = Math.round(input.items.reduce((sum, row) => sum + row.qty * row.salePrice, 0) * 100) / 100;
  return { totalAmount, ...calcVat(Math.max(0, totalAmount - input.discount), input.vatType, input.vatRate) };
};

export const formatQuotationReference = (number: string, revision = 0) => revision > 0 ? `${number} Rev.${String(revision).padStart(2, "0")}` : number;

/** Compare business values only: record ids, actors and timestamps aren't a revision. */
export const quotationFingerprint = (input: QuotationData) => JSON.stringify([
  input.quotationDate, input.customerId, input.customerName.trim(), input.customerPhone ?? "", input.customerAddress ?? "",
  input.creditTerm, input.saleType, input.discount, input.note ?? "", input.vatType, input.vatRate,
  input.items.map((row) => [row.productId, row.unitName, row.qty, row.salePrice, Math.max(row.unitListPrice, row.salePrice), row.moreDetail ?? "", row.priceListId ?? null, row.pricePromotionId ?? null]),
]);

