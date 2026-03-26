"use server";

import { db } from "@/lib/db";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeStockCard, recalculateStockCard } from "@/lib/stock-card";
import { generateDocNo } from "@/lib/doc-number";
import { FulfillmentType, PaymentMethod, Prisma, SalePaymentType, SaleType, VatType } from "@/lib/generated/prisma";
import { calcVat, calcItemSubtotal } from "@/lib/vat";
import { recalculateSaleAmountRemain } from "@/lib/amount-remain";

const saleItemSchema = z.object({
  productId:    z.string().min(1).max(50),
  unitName:     z.string().min(1).max(20),
  qty:          z.coerce.number().positive("จำนวนต้องมากกว่า 0"),
  salePrice:    z.coerce.number().min(0, "ราคาต้องไม่ติดลบ"),
  warrantyDays: z.coerce.number().int().min(0).default(0),
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
  const salePrefix = paymentType === "CREDIT_SALE" ? "SAC" : "SA";
  const saleNo  = await generateDocNo(salePrefix, docDate);

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
          amountRemain:    new Prisma.Decimal(paymentType === "CREDIT_SALE" ? netAmount : 0),
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
            warrantyDays:  item.warrantyDays,
          },
        });

        // Auto-create Warranty if warrantyDays > 0
        if (item.warrantyDays > 0) {
          const startDate = new Date(docDate);
          const endDate   = new Date(startDate);
          endDate.setDate(endDate.getDate() + item.warrantyDays);
          await tx.warranty.create({
            data: {
              saleId:       sale.id,
              saleItemId:   saleItem.id,
              productId:    item.productId,
              warrantyDays: item.warrantyDays,
              startDate,
              endDate,
            },
          });
        }

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

const cancelSaleSchema = z.object({
  saleId:     z.string().min(1),
  cancelNote: z.string().max(200).optional(),
});

export async function cancelSale(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = cancelSaleSchema.safeParse({
    saleId:     formData.get("saleId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { saleId, cancelNote } = parsed.data;

  const sale = await db.sale.findUnique({
    where: { id: saleId },
    include: {
      items:       { select: { productId: true } },
      creditNotes: { where: { status: "ACTIVE" }, select: { cnNo: true } },
      receipts:    { include: { receipt: { select: { receiptNo: true, status: true } } } },
    },
  });
  if (!sale)                        return { error: "ไม่พบเอกสาร" };
  if (sale.status === "CANCELLED")  return { error: "เอกสารถูกยกเลิกไปแล้ว" };

  // Reference chain: ตรวจ CN ที่ยัง active
  if (sale.creditNotes.length > 0) {
    const nos = sale.creditNotes.map((cn) => cn.cnNo).join(", ");
    return { error: `ไม่สามารถยกเลิกได้ มีใบลดหนี้ที่อ้างอิงอยู่: ${nos} — กรุณายกเลิก CN ก่อน` };
  }

  // Reference chain: ตรวจใบเสร็จที่ยัง active
  const activeReceipts = sale.receipts
    .filter((ri) => ri.receipt.status === "ACTIVE")
    .map((ri) => ri.receipt);
  if (activeReceipts.length > 0) {
    const nos = activeReceipts.map((r) => r.receiptNo).join(", ");
    return { error: `ไม่สามารถยกเลิกได้ มีใบเสร็จรับเงินที่อ้างอิงอยู่: ${nos} — กรุณายกเลิกใบเสร็จก่อน` };
  }

  const affectedProductIds = [...new Set(sale.items.map((i) => i.productId))];

  try {
    await db.$transaction(async (tx) => {
      await tx.stockCard.deleteMany({ where: { docNo: sale.saleNo } });
      for (const productId of affectedProductIds) {
        await recalculateStockCard(tx, productId);
      }
      // ลบ warranties ที่ auto-generated จากใบขายนี้
      await tx.warranty.deleteMany({ where: { saleId } });
      await tx.sale.update({
        where: { id: saleId },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelNote, amountRemain: new Prisma.Decimal(0) },
      });
    });
    revalidatePath("/admin/sales");
    return { success: true };
  } catch (err) {
    console.error("[cancelSale]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

// ─────────────────────────────────────────
// updateSale
// ─────────────────────────────────────────

export async function updateSale(
  id: string,
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสเอกสารไม่ถูกต้อง" };
  }

  const existing = await db.sale.findUnique({
    where: { id },
    include: {
      items:       { select: { productId: true } },
      creditNotes: { where: { status: "ACTIVE" }, select: { cnNo: true } },
      receipts:    { include: { receipt: { select: { receiptNo: true, status: true } } } },
    },
  });
  if (!existing)                        return { error: "ไม่พบเอกสาร" };
  if (existing.status === "CANCELLED")  return { error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้" };
  if (existing.creditNotes.length > 0) {
    const nos = existing.creditNotes.map((cn) => cn.cnNo).join(", ");
    return { error: `ไม่สามารถแก้ไขได้ มีใบลดหนี้ที่อ้างอิงอยู่: ${nos}` };
  }
  const activeReceipts = existing.receipts.filter((ri) => ri.receipt.status === "ACTIVE");
  if (activeReceipts.length > 0) {
    const nos = activeReceipts.map((ri) => ri.receipt.receiptNo).join(", ");
    return { error: `ไม่สามารถแก้ไขได้ มีใบเสร็จรับเงินที่อ้างอิงอยู่: ${nos}` };
  }

  let items: z.infer<typeof saleItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch { return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" }; }

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

  const { saleDate, customerId, saleType, paymentType, fulfillmentType, customerName, customerPhone, shippingAddress, shippingFee, discount, paymentMethod, note, vatType, vatRate, items: validItems } = parsed.data;

  const totalAmount     = validItems.reduce((sum, item) => sum + item.qty * item.salePrice, 0);
  const discountedTotal = Math.max(0, totalAmount + shippingFee - discount);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(discountedTotal, vatType, vatRate);
  const docDate = new Date(saleDate);

  const oldProductIds = [...new Set(existing.items.map((i) => i.productId))];

  try {
    await db.$transaction(async (tx) => {
      // 1. Reverse old stock + warranties
      await tx.stockCard.deleteMany({ where: { docNo: existing.saleNo } });
      await tx.saleItem.deleteMany({ where: { saleId: id } });
      await tx.warranty.deleteMany({ where: { saleId: id } });
      for (const productId of oldProductIds) {
        await recalculateStockCard(tx, productId);
      }

      // 2. Update header
      await tx.sale.update({
        where: { id },
        data: {
          saleDate:        docDate,
          customerId:      customerId      ?? null,
          saleType,
          paymentType,
          fulfillmentType,
          customerName:    customerName    ?? null,
          customerPhone:   customerPhone   ?? null,
          shippingAddress: shippingAddress ?? null,
          shippingFee,
          discount,
          paymentMethod:   paymentMethod   ?? null,
          note:            note            ?? null,
          vatType,
          vatRate,
          totalAmount,
          subtotalAmount,
          vatAmount,
          netAmount,
          amountRemain:    new Prisma.Decimal(paymentType === "CREDIT_SALE" ? netAmount : 0),
        },
      });

      // 3. Re-create items + stock cards + warranties
      for (const item of validItems) {
        const unit = await tx.productUnit.findUnique({
          where: { productId_name: { productId: item.productId, name: item.unitName } },
        });
        if (!unit) throw new Error(`ไม่พบหน่วยนับ ${item.unitName} ของสินค้า`);

        const scale     = Number(unit.scale);
        const qtyInBase = item.qty * scale;
        const prod = await tx.product.findUnique({ where: { id: item.productId }, select: { avgCost: true } });
        if (!prod) throw new Error("ไม่พบสินค้า");
        const costPerBase  = Number(prod.avgCost);
        const itemTotal    = item.qty * item.salePrice;
        const itemSubtotal = calcItemSubtotal(itemTotal, vatType, vatRate);

        const saleItem = await tx.saleItem.create({
          data: { saleId: id, productId: item.productId, quantity: Math.round(qtyInBase), salePrice: item.salePrice, costPrice: costPerBase, totalAmount: itemTotal, subtotalAmount: itemSubtotal, warrantyDays: item.warrantyDays },
        });

        if (item.warrantyDays > 0) {
          const startDate = new Date(docDate);
          const endDate   = new Date(startDate);
          endDate.setDate(endDate.getDate() + item.warrantyDays);
          await tx.warranty.create({
            data: { saleId: id, saleItemId: saleItem.id, productId: item.productId, warrantyDays: item.warrantyDays, startDate, endDate },
          });
        }

        await writeStockCard(tx, {
          productId:   item.productId,
          docNo:       existing.saleNo,
          docDate,
          source:      "SALE",
          qtyIn:       0,
          qtyOut:      qtyInBase,
          priceIn:     0,
          detail:      `ขาย ${item.qty} ${item.unitName}`,
          referenceId: saleItem.id,
        });
      }

      // 4. Recalculate amountRemain after updating netAmount
      await recalculateSaleAmountRemain(tx, id);
    });

    revalidatePath("/admin/sales");
    revalidatePath(`/admin/sales/${id}`);
    revalidatePath("/admin/products");
    return { success: true };
  } catch (err) {
    console.error("[updateSale]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
