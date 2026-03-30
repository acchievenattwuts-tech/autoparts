"use server";

import { db, dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeStockCard, recalculateStockCard } from "@/lib/stock-card";
import { generateCNNo } from "@/lib/doc-number";
import { CNRefundMethod, CNSettlementType, CreditNoteType, VatType } from "@/lib/generated/prisma";
import { calcVat, calcItemSubtotal } from "@/lib/vat";
import { recalculateSaleAmountRemain } from "@/lib/amount-remain";

const cnItemSchema = z.object({
  productId: z.string().min(1).max(50),
  unitName:  z.string().min(1).max(20),
  qty:       z.coerce.number().positive("จำนวนต้องมากกว่า 0"),
  salePrice: z.coerce.number().min(0, "ราคาต้องไม่ติดลบ"),
});

const cnSchema = z.object({
  cnDate:         z.string().min(1, "กรุณาระบุวันที่"),
  customerId:     z.string().min(1, "กรุณาเลือกลูกค้า").max(50),
  customerName:   z.string().max(100).optional(),
  saleId:         z.string().max(50).optional(),
  type:           z.nativeEnum(CreditNoteType),
  settlementType: z.nativeEnum(CNSettlementType).default(CNSettlementType.CASH_REFUND),
  refundMethod:   z.nativeEnum(CNRefundMethod).optional(),
  note:           z.string().max(500).optional(),
  vatType:        z.nativeEnum(VatType).default(VatType.NO_VAT),
  vatRate:        z.coerce.number().min(0).max(100).default(0),
  items:          z.array(cnItemSchema).min(1, "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ").max(100),
});

export async function createCreditNote(
  formData: FormData
): Promise<{ success?: boolean; cnNo?: string; error?: string }> {
  const session = await requirePermission("credit_notes.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  let items: z.infer<typeof cnItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch {
    return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" };
  }

  const parsed = cnSchema.safeParse({
    cnDate:         formData.get("cnDate"),
    customerId:     formData.get("customerId") || undefined,
    customerName:   formData.get("customerName") || undefined,
    saleId:         formData.get("saleId") || undefined,
    type:           formData.get("type"),
    settlementType: formData.get("settlementType") || CNSettlementType.CASH_REFUND,
    refundMethod:   (formData.get("refundMethod") as CNRefundMethod) || undefined,
    note:           formData.get("note") || undefined,
    vatType:        (formData.get("vatType") as VatType) || VatType.NO_VAT,
    vatRate:        formData.get("vatRate") || 0,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { cnDate, customerId, customerName, saleId, type, settlementType, refundMethod, note, vatType, vatRate, items: validItems } = parsed.data;

  const totalAmount = validItems.reduce((sum, item) => sum + item.qty * item.salePrice, 0);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(totalAmount, vatType, vatRate);

  const docDate = new Date(cnDate);
  const cnNo    = await generateCNNo(docDate);

  try {
    await dbTx(async (tx) => {
      // Create CreditNote header
      const cn = await tx.creditNote.create({
        data: {
          cnNo,
          saleId:         saleId || null,
          customerId:     customerId || null,
          customerName:   customerName ?? null,
          userId:         session.user!.id!,
          type,
          settlementType,
          refundMethod:   refundMethod ?? null,
          totalAmount:    netAmount,
          vatType,
          vatRate,
          subtotalAmount,
          vatAmount,
          note:           note ?? null,
          cnDate:         docDate,
        },
      });

      // Process each line item
      for (const item of validItems) {
        // Get unit scale
        const unit = await tx.productUnit.findUnique({
          where: { productId_name: { productId: item.productId, name: item.unitName } },
        });
        if (!unit) throw new Error(`ไม่พบหน่วยนับ ${item.unitName} ของสินค้า`);

        const scale     = Number(unit.scale);
        const qtyInBase = item.qty * scale;
        const itemTotal = item.qty * item.salePrice;
        const itemSubtotal = calcItemSubtotal(itemTotal, vatType, vatRate);

        // Create CreditNoteItem (real DB field names: creditNoteId, qty, unitPrice, amount)
        await tx.creditNoteItem.create({
          data: {
            creditNoteId:  cn.id,
            productId:     item.productId,
            qty:           Math.round(qtyInBase),
            unitPrice:     item.salePrice,
            amount:        itemTotal,
            subtotalAmount: itemSubtotal,
          },
        });

        // Write StockCard only for RETURN type
        if (type === CreditNoteType.RETURN) {
          await writeStockCard(tx, {
            productId:   item.productId,
            docNo:       cnNo,
            docDate,
            source:      "RETURN_IN",
            qtyIn:       qtyInBase,
            qtyOut:      0,
            priceIn:     0,
            detail:      `รับคืน ${item.qty} ${item.unitName}`,
            referenceId: cn.id,
          });
        }
      }
    });

    // Recalculate sale amountRemain if linked sale exists (DISCOUNT reduces outstanding)
    if (saleId) {
      await dbTx(async (tx) => {
        await recalculateSaleAmountRemain(tx, saleId);
      });
    }

    revalidatePath("/admin/credit-notes");
    revalidatePath("/admin/products");
    return { success: true, cnNo };
  } catch (err) {
    console.error("[createCreditNote]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

const cancelCNSchema = z.object({
  cnId:       z.string().min(1),
  cancelNote: z.string().max(200).optional(),
});

export async function cancelCreditNote(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("credit_notes.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = cancelCNSchema.safeParse({
    cnId:       formData.get("cnId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { cnId, cancelNote } = parsed.data;

  const cn = await db.creditNote.findUnique({
    where: { id: cnId },
    include: { items: { select: { productId: true } } },
  });
  if (!cn)                        return { error: "ไม่พบเอกสาร" };
  if (cn.status === "CANCELLED")  return { error: "เอกสารถูกยกเลิกไปแล้ว" };

  const affectedProductIds = [
    ...new Set(cn.items.map((i) => i.productId).filter((id): id is string => id !== null)),
  ];

  try {
    await dbTx(async (tx) => {
      // ถ้าเป็น RETURN ให้ลบ StockCard และ recalculate
      if (cn.type === "RETURN" && affectedProductIds.length > 0) {
        await tx.stockCard.deleteMany({ where: { docNo: cn.cnNo } });
        for (const productId of affectedProductIds) {
          await recalculateStockCard(tx, productId);
        }
      }

      await tx.creditNote.update({
        where: { id: cnId },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelNote },
      });
      if (cn.saleId) {
        await recalculateSaleAmountRemain(tx, cn.saleId);
      }
    });
    revalidatePath("/admin/credit-notes");
    return { success: true };
  } catch (err) {
    console.error("[cancelCreditNote]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

// ─────────────────────────────────────────
// updateCreditNote
// ─────────────────────────────────────────

export async function updateCreditNote(
  id: string,
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("credit_notes.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสเอกสารไม่ถูกต้อง" };
  }

  const existing = await db.creditNote.findUnique({
    where: { id },
    include: { items: { select: { productId: true } } },
  });
  if (!existing)                       return { error: "ไม่พบเอกสาร" };
  if (existing.status === "CANCELLED") return { error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้" };

  let items: z.infer<typeof cnItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch { return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" }; }

  const parsed = cnSchema.safeParse({
    cnDate:         formData.get("cnDate"),
    customerId:     formData.get("customerId") || undefined,
    customerName:   formData.get("customerName") || undefined,
    saleId:         formData.get("saleId") || undefined,
    type:           formData.get("type"),
    settlementType: formData.get("settlementType") || CNSettlementType.CASH_REFUND,
    refundMethod:   (formData.get("refundMethod") as CNRefundMethod) || undefined,
    note:           formData.get("note") || undefined,
    vatType:        (formData.get("vatType") as VatType) || VatType.NO_VAT,
    vatRate:        formData.get("vatRate") || 0,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { cnDate, customerId, customerName, saleId, type, settlementType, refundMethod, note, vatType, vatRate, items: validItems } = parsed.data;

  const totalAmount = validItems.reduce((sum, item) => sum + item.qty * item.salePrice, 0);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(totalAmount, vatType, vatRate);

  const docDate = new Date(cnDate);
  const oldProductIds = [
    ...new Set(existing.items.map((i) => i.productId).filter((pid): pid is string => pid !== null)),
  ];

  try {
    await dbTx(async (tx) => {
      // 1. Reverse old stock effects (only if old type was RETURN)
      if (existing.type === "RETURN" && oldProductIds.length > 0) {
        await tx.stockCard.deleteMany({ where: { docNo: existing.cnNo } });
        for (const productId of oldProductIds) {
          await recalculateStockCard(tx, productId);
        }
      }

      // 2. Delete old line items
      await tx.creditNoteItem.deleteMany({ where: { creditNoteId: id } });

      // 3. Update header
      await tx.creditNote.update({
        where: { id },
        data: {
          cnDate:         docDate,
          saleId:         saleId || null,
          customerId:     customerId || null,
          customerName:   customerName ?? null,
          type,
          settlementType,
          refundMethod:   refundMethod ?? null,
          totalAmount:    netAmount,
          vatType,
          vatRate,
          subtotalAmount,
          vatAmount,
          note:           note ?? null,
        },
      });

      // 4. Re-create items + stock cards
      for (const item of validItems) {
        const unit = await tx.productUnit.findUnique({
          where: { productId_name: { productId: item.productId, name: item.unitName } },
        });
        if (!unit) throw new Error(`ไม่พบหน่วยนับ ${item.unitName} ของสินค้า`);

        const scale     = Number(unit.scale);
        const qtyInBase = item.qty * scale;
        const itemTotal = item.qty * item.salePrice;
        const itemSubtotal = calcItemSubtotal(itemTotal, vatType, vatRate);

        await tx.creditNoteItem.create({
          data: {
            creditNoteId:   id,
            productId:      item.productId,
            qty:            Math.round(qtyInBase),
            unitPrice:      item.salePrice,
            amount:         itemTotal,
            subtotalAmount: itemSubtotal,
          },
        });

        if (type === CreditNoteType.RETURN) {
          await writeStockCard(tx, {
            productId:   item.productId,
            docNo:       existing.cnNo,
            docDate,
            source:      "RETURN_IN",
            qtyIn:       qtyInBase,
            qtyOut:      0,
            priceIn:     0,
            detail:      `รับคืน ${item.qty} ${item.unitName}`,
            referenceId: id,
          });
        }
      }
    });

    // Recalculate sale amountRemain if linked sale exists
    const effectiveSaleId = saleId || existing.saleId;
    if (effectiveSaleId) {
      await dbTx(async (tx) => {
        await recalculateSaleAmountRemain(tx, effectiveSaleId);
      });
    }

    revalidatePath("/admin/credit-notes");
    revalidatePath(`/admin/credit-notes/${id}`);
    revalidatePath("/admin/products");
    return { success: true };
  } catch (err) {
    console.error("[updateCreditNote]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

// ─────────────────────────────────────────
// getSalesForCustomer — ดึงใบขายของลูกค้า
// ─────────────────────────────────────────
export async function getSalesForCustomer(
  customerId: string
): Promise<{ id: string; saleNo: string; saleDate: Date; customerName: string | null }[]> {
  if (!customerId) return [];
  return db.sale.findMany({
    where: { customerId, status: "ACTIVE" },
    orderBy: { saleDate: "desc" },
    take: 200,
    select: { id: true, saleNo: true, saleDate: true, customerName: true },
  });
}

// ─────────────────────────────────────────
// getSaleDetail — ดึง items จากใบขาย
// ─────────────────────────────────────────
export type SaleDetailResult = {
  customerName: string | null;
  vatType: string;
  vatRate: number;
  items: { productId: string; unitName: string; qty: number; salePrice: number }[];
} | null;

export async function getSaleDetail(saleId: string): Promise<SaleDetailResult> {
  if (!saleId) return null;
  const sale = await db.sale.findUnique({
    where: { id: saleId },
    select: {
      customerName: true,
      vatType: true,
      vatRate: true,
      items: {
        select: {
          productId: true,
          quantity:  true,
          salePrice: true,
          product: {
            select: {
              saleUnitName: true,
              units: { select: { name: true, scale: true, isBase: true } },
            },
          },
        },
      },
    },
  });
  if (!sale) return null;

  const items = sale.items.map((item) => {
    const unitName = item.product.saleUnitName ?? "";
    const unit     = item.product.units.find((u) => u.name === unitName);
    const scale    = unit?.scale ?? 1;
    return {
      productId: item.productId,
      unitName,
      qty:       Number(item.quantity) / scale,
      salePrice: Number(item.salePrice),
    };
  });

  return {
    customerName: sale.customerName,
    vatType:      sale.vatType,
    vatRate:      Number(sale.vatRate),
    items,
  };
}
