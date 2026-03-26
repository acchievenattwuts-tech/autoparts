"use server";

import { db } from "@/lib/db";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeStockCard, recalculateStockCard } from "@/lib/stock-card";
import { generateDocNo } from "@/lib/doc-number";
import { VatType } from "@/lib/generated/prisma";
import { calcVat, calcItemSubtotal } from "@/lib/vat";

const returnItemSchema = z.object({
  productId: z.string().min(1).max(50),
  unitName:  z.string().min(1).max(20),
  qty:       z.coerce.number().positive("จำนวนต้องมากกว่า 0"),
});

const returnSchema = z.object({
  returnDate: z.string().min(1, "กรุณาระบุวันที่"),
  purchaseId: z.string().max(50).optional(),
  supplierId: z.string().max(50).optional(),
  note:       z.string().max(500).optional(),
  vatType:    z.nativeEnum(VatType).default(VatType.NO_VAT),
  vatRate:    z.coerce.number().min(0).max(100).default(0),
  items:      z.array(returnItemSchema).min(1, "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ").max(100),
});

export async function createPurchaseReturn(
  formData: FormData
): Promise<{ success?: boolean; returnNo?: string; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  let items: z.infer<typeof returnItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch {
    return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" };
  }

  const parsed = returnSchema.safeParse({
    returnDate: formData.get("returnDate"),
    purchaseId: formData.get("purchaseId") || undefined,
    supplierId: formData.get("supplierId") || undefined,
    note:       formData.get("note") || undefined,
    vatType:    (formData.get("vatType") as VatType) || VatType.NO_VAT,
    vatRate:    formData.get("vatRate") || 0,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { returnDate, purchaseId, supplierId, note, vatType, vatRate, items: validItems } = parsed.data;

  const docDate  = new Date(returnDate);
  const returnNo = await generateDocNo("CNRR", docDate);

  try {
    await db.$transaction(async (tx) => {
      // Pre-calculate: gather unit/cost data for all items
      const lineData: {
        productId:     string;
        unitName:      string;
        qty:           number;
        qtyInBase:     number;
        costPerBase:   number;
        totalAmount:   number;
        subtotalAmount: number;
      }[] = [];

      for (const item of validItems) {
        const unit = await tx.productUnit.findUnique({
          where: { productId_name: { productId: item.productId, name: item.unitName } },
        });
        if (!unit) throw new Error(`ไม่พบหน่วยนับ ${item.unitName} ของสินค้า`);

        const scale     = Number(unit.scale);
        const qtyInBase = item.qty * scale;

        const prod = await tx.product.findUnique({
          where: { id: item.productId },
          select: { avgCost: true },
        });
        if (!prod) throw new Error("ไม่พบสินค้า");

        const costPerBase  = Number(prod.avgCost);
        const totalAmount  = Math.round(qtyInBase) * costPerBase;
        const itemSubtotal = calcItemSubtotal(totalAmount, vatType, vatRate);

        lineData.push({
          productId: item.productId,
          unitName:  item.unitName,
          qty:       item.qty,
          qtyInBase,
          costPerBase,
          totalAmount,
          subtotalAmount: itemSubtotal,
        });
      }

      const rawTotal    = lineData.reduce((sum, l) => sum + l.totalAmount, 0);
      const { subtotalAmount, vatAmount, netAmount } = calcVat(rawTotal, vatType, vatRate);

      // Create PurchaseReturn header
      const pr = await tx.purchaseReturn.create({
        data: {
          returnNo,
          purchaseId:    purchaseId || null,
          supplierId:    supplierId || null,
          userId:        session.user!.id!,
          totalAmount:   netAmount,
          vatType,
          vatRate,
          subtotalAmount,
          vatAmount,
          note:          note ?? null,
          returnDate:    docDate,
        },
      });

      // Create items and write stock cards
      for (const line of lineData) {
        await tx.purchaseReturnItem.create({
          data: {
            purchaseReturnId: pr.id,
            productId:        line.productId,
            qty:              Math.round(line.qtyInBase),
            costPrice:        line.costPerBase,
            amount:           line.totalAmount,
            subtotalAmount:   line.subtotalAmount,
            detail:           `คืน ${line.qty} ${line.unitName}`,
          },
        });

        await writeStockCard(tx, {
          productId:   line.productId,
          docNo:       returnNo,
          docDate,
          source:      "RETURN_OUT",
          qtyIn:       0,
          qtyOut:      line.qtyInBase,
          priceIn:     0,
          detail:      `คืน ${line.qty} ${line.unitName}`,
          referenceId: pr.id,
        });
      }
    });

    revalidatePath("/admin/purchase-returns");
    revalidatePath("/admin/products");
    return { success: true, returnNo };
  } catch (err) {
    console.error("[createPurchaseReturn]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

const cancelReturnSchema = z.object({
  returnId:   z.string().min(1),
  cancelNote: z.string().max(200).optional(),
});

export async function cancelPurchaseReturn(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = cancelReturnSchema.safeParse({
    returnId:   formData.get("returnId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { returnId, cancelNote } = parsed.data;

  const ret = await db.purchaseReturn.findUnique({
    where: { id: returnId },
    include: { items: { select: { productId: true } } },
  });
  if (!ret)                        return { error: "ไม่พบเอกสาร" };
  if (ret.status === "CANCELLED")  return { error: "เอกสารถูกยกเลิกไปแล้ว" };

  const affectedProductIds = [...new Set(ret.items.map((i) => i.productId))];

  try {
    await db.$transaction(async (tx) => {
      await tx.stockCard.deleteMany({ where: { docNo: ret.returnNo } });
      for (const productId of affectedProductIds) {
        await recalculateStockCard(tx, productId);
      }
      await tx.purchaseReturn.update({
        where: { id: returnId },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelNote },
      });
    });
    revalidatePath("/admin/purchase-returns");
    return { success: true };
  } catch (err) {
    console.error("[cancelPurchaseReturn]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

// ─────────────────────────────────────────
// updatePurchaseReturn
// ─────────────────────────────────────────

export async function updatePurchaseReturn(
  id: string,
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสเอกสารไม่ถูกต้อง" };
  }

  const existing = await db.purchaseReturn.findUnique({
    where: { id },
    include: { items: { select: { productId: true } } },
  });
  if (!existing)                        return { error: "ไม่พบเอกสาร" };
  if (existing.status === "CANCELLED")  return { error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้" };

  let items: z.infer<typeof returnItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch { return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" }; }

  const parsed = returnSchema.safeParse({
    returnDate: formData.get("returnDate"),
    purchaseId: formData.get("purchaseId") || undefined,
    supplierId: formData.get("supplierId") || undefined,
    note:       formData.get("note") || undefined,
    vatType:    (formData.get("vatType") as VatType) || VatType.NO_VAT,
    vatRate:    formData.get("vatRate") || 0,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { returnDate, purchaseId, supplierId, note, vatType, vatRate, items: validItems } = parsed.data;
  const docDate    = new Date(returnDate);
  const oldProductIds = [...new Set(existing.items.map((i) => i.productId))];

  try {
    await db.$transaction(async (tx) => {
      // 1. Reverse old stock effects
      await tx.stockCard.deleteMany({ where: { docNo: existing.returnNo } });
      await tx.purchaseReturnItem.deleteMany({ where: { purchaseReturnId: id } });
      for (const productId of oldProductIds) {
        await recalculateStockCard(tx, productId);
      }

      // 2. Build new line data (uses current avgCost at time of update)
      const lineData: {
        productId:     string;
        unitName:      string;
        qty:           number;
        qtyInBase:     number;
        costPerBase:   number;
        totalAmount:   number;
        subtotalAmount: number;
      }[] = [];

      for (const item of validItems) {
        const unit = await tx.productUnit.findUnique({
          where: { productId_name: { productId: item.productId, name: item.unitName } },
        });
        if (!unit) throw new Error(`ไม่พบหน่วยนับ ${item.unitName} ของสินค้า`);

        const scale     = Number(unit.scale);
        const qtyInBase = item.qty * scale;
        const prod = await tx.product.findUnique({
          where: { id: item.productId },
          select: { avgCost: true },
        });
        if (!prod) throw new Error("ไม่พบสินค้า");
        const costPerBase  = Number(prod.avgCost);
        const totalAmount  = Math.round(qtyInBase) * costPerBase;
        const itemSubtotal = calcItemSubtotal(totalAmount, vatType, vatRate);
        lineData.push({ productId: item.productId, unitName: item.unitName, qty: item.qty, qtyInBase, costPerBase, totalAmount, subtotalAmount: itemSubtotal });
      }

      const rawTotal = lineData.reduce((sum, l) => sum + l.totalAmount, 0);
      const { subtotalAmount, vatAmount, netAmount } = calcVat(rawTotal, vatType, vatRate);

      // 3. Update header
      await tx.purchaseReturn.update({
        where: { id },
        data: { purchaseId: purchaseId || null, supplierId: supplierId || null, note: note ?? null, vatType, vatRate, totalAmount: netAmount, subtotalAmount, vatAmount, returnDate: docDate },
      });

      // 4. Re-create items + stock cards
      for (const line of lineData) {
        await tx.purchaseReturnItem.create({
          data: { purchaseReturnId: id, productId: line.productId, qty: Math.round(line.qtyInBase), costPrice: line.costPerBase, amount: line.totalAmount, subtotalAmount: line.subtotalAmount, detail: `คืน ${line.qty} ${line.unitName}` },
        });
        await writeStockCard(tx, {
          productId:   line.productId,
          docNo:       existing.returnNo,
          docDate,
          source:      "RETURN_OUT",
          qtyIn:       0,
          qtyOut:      line.qtyInBase,
          priceIn:     0,
          detail:      `คืน ${line.qty} ${line.unitName}`,
          referenceId: id,
        });
      }
    });

    revalidatePath("/admin/purchase-returns");
    revalidatePath(`/admin/purchase-returns/${id}`);
    revalidatePath("/admin/products");
    return { success: true };
  } catch (err) {
    console.error("[updatePurchaseReturn]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
