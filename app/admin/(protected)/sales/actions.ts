"use server";

import { db } from "@/lib/db";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeStockCard } from "@/lib/stock-card";
import { generateDocNo } from "@/lib/doc-number";
import { FulfillmentType, PaymentMethod, SalePaymentType, SaleType, VatType } from "@/lib/generated/prisma";
import { calcVat, calcItemSubtotal } from "@/lib/vat";

const saleItemSchema = z.object({
  productId: z.string().min(1).max(50),
  unitName:  z.string().min(1).max(20),
  qty:       z.coerce.number().positive("จำนวนต้องมากกว่า 0"),
  salePrice: z.coerce.number().min(0, "ราคาต้องไม่ติดลบ"),
});

const saleSchema = z.object({
  saleDate:        z.string().min(1, "กรุณาระบุวันที่"),
  customerId:      z.string().max(50).optional(),
  saleType:        z.nativeEnum(SaleType).default(SaleType.RETAIL),
  paymentType:     z.nativeEnum(SalePaymentType).default(SalePaymentType.CASH_SALE),
  fulfillmentType: z.nativeEnum(FulfillmentType).default(FulfillmentType.PICKUP),
  customerName:    z.string().max(100).optional(),
  customerPhone:   z.string().max(20).optional(),
  shippingAddress: z.string().max(500).optional(),
  shippingFee:     z.coerce.number().min(0).default(0),
  discount:        z.coerce.number().min(0).default(0),
  paymentMethod:   z.nativeEnum(PaymentMethod).optional(),
  note:            z.string().max(500).optional(),
  vatType:         z.nativeEnum(VatType).default(VatType.NO_VAT),
  vatRate:         z.coerce.number().min(0).max(100).default(0),
  items:           z.array(saleItemSchema).min(1, "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ").max(100),
});

export async function createSale(
  formData: FormData
): Promise<{ success?: boolean; saleNo?: string; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  let items: z.infer<typeof saleItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch {
    return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" };
  }

  const parsed = saleSchema.safeParse({
    saleDate:        formData.get("saleDate"),
    customerId:      formData.get("customerId")      || undefined,
    saleType:        formData.get("saleType")        || SaleType.RETAIL,
    paymentType:     formData.get("paymentType")     || SalePaymentType.CASH_SALE,
    fulfillmentType: formData.get("fulfillmentType") || FulfillmentType.PICKUP,
    customerName:    formData.get("customerName")    || undefined,
    customerPhone:   formData.get("customerPhone")   || undefined,
    shippingAddress: formData.get("shippingAddress") || undefined,
    shippingFee:     formData.get("shippingFee")     || 0,
    discount:        formData.get("discount")        || 0,
    paymentMethod:   formData.get("paymentMethod")   || undefined,
    note:            formData.get("note")            || undefined,
    vatType:         (formData.get("vatType") as VatType) || VatType.NO_VAT,
    vatRate:         formData.get("vatRate")         || 0,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const {
    saleDate,
    customerId,
    saleType,
    paymentType,
    fulfillmentType,
    customerName,
    customerPhone,
    shippingAddress,
    shippingFee,
    discount,
    paymentMethod,
    note,
    vatType,
    vatRate,
    items: validItems,
  } = parsed.data;

  // Calculate totals
  const totalAmount = validItems.reduce((sum, item) => sum + item.qty * item.salePrice, 0);
  const discountedTotal = Math.max(0, totalAmount + shippingFee - discount);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(discountedTotal, vatType, vatRate);

  const docDate = new Date(saleDate);
  const saleNo  = await generateDocNo("SO", docDate);

  try {
    await db.$transaction(async (tx) => {
      // 1. Create Sale header
      const sale = await tx.sale.create({
        data: {
          saleNo,
          customerId:      customerId      ?? null,
          saleType,
          paymentType,
          fulfillmentType,
          shippingAddress: shippingAddress ?? null,
          shippingFee,
          customerName:    customerName    ?? null,
          customerPhone:   customerPhone   ?? null,
          userId:          session.user!.id!,
          totalAmount,
          discount,
          netAmount,
          vatType,
          vatRate,
          subtotalAmount,
          vatAmount,
          paymentMethod:   paymentMethod   ?? null,
          note:            note            ?? null,
          saleDate:        docDate,
        },
      });

      // 2. Process each line item
      for (const item of validItems) {
        // Get unit scale
        const unit = await tx.productUnit.findUnique({
          where: { productId_name: { productId: item.productId, name: item.unitName } },
        });
        if (!unit) throw new Error(`ไม่พบหน่วยนับ ${item.unitName} ของสินค้า`);

        const scale      = Number(unit.scale);
        const qtyInBase  = item.qty * scale;

        // Get current product avgCost for COGS
        const prod = await tx.product.findUnique({
          where: { id: item.productId },
          select: { avgCost: true },
        });
        if (!prod) throw new Error(`ไม่พบสินค้า`);
        const costPerBase = Number(prod.avgCost);

        const itemTotal    = item.qty * item.salePrice;
        const itemSubtotal = calcItemSubtotal(itemTotal, vatType, vatRate);

        // Create SaleItem
        const saleItem = await tx.saleItem.create({
          data: {
            saleId:        sale.id,
            productId:     item.productId,
            quantity:      Math.round(qtyInBase),
            salePrice:     item.salePrice,
            costPrice:     costPerBase,
            totalAmount:   itemTotal,
            subtotalAmount: itemSubtotal,
          },
        });

        // Write StockCard (outgoing)
        await writeStockCard(tx, {
          productId:   item.productId,
          docNo:       saleNo,
          docDate,
          source:      "SALE",
          qtyIn:       0,
          qtyOut:      qtyInBase,
          priceIn:     0,
          detail:      `ขาย ${item.qty} ${item.unitName}`,
          referenceId: saleItem.id,
        });
      }
    });

    revalidatePath("/admin/sales");
    revalidatePath("/admin/products");
    return { success: true, saleNo };
  } catch (err) {
    console.error("[createSale]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
