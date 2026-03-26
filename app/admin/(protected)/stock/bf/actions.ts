"use server";

import { db, dbTx } from "@/lib/db";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeStockCard, recalculateStockCard } from "@/lib/stock-card";
import { generateDocNo } from "@/lib/doc-number";

const bfSchema = z.object({
  productId:        z.string().min(1).max(50),
  unitName:         z.string().min(1).max(20),
  qty:              z.coerce.number().positive("จำนวนต้องมากกว่า 0"),
  costPerBaseUnit:  z.coerce.number().min(0, "ราคาต้นทุนต้องไม่ติดลบ"),
  docDate:          z.string().min(1),
  note:             z.string().max(500).optional(),
});

export async function createBF(
  formData: FormData
): Promise<{ success?: boolean; docNo?: string; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = bfSchema.safeParse({
    productId:       formData.get("productId"),
    unitName:        formData.get("unitName"),
    qty:             formData.get("qty"),
    costPerBaseUnit: formData.get("costPerBaseUnit"),
    docDate:         formData.get("docDate"),
    note:            formData.get("note") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { productId, unitName, qty, costPerBaseUnit, docDate, note } = parsed.data;

  const unit = await db.productUnit.findUnique({
    where: { productId_name: { productId, name: unitName } },
  });
  if (!unit) return { error: "ไม่พบหน่วยนับที่เลือก" };

  const qtyInBase = qty * Number(unit.scale);
  const docNo     = await generateDocNo("BF", new Date(docDate));

  try {
    await dbTx(async (tx) => {
      // Create BalanceForward header
      await tx.balanceForward.create({
        data: {
          docNo,
          docDate:         new Date(docDate),
          productId,
          unitName,
          qtyInBase,
          costPerBaseUnit,
          note,
          userId: session.user!.id!,
        },
      });

      await writeStockCard(tx, {
        productId,
        docNo,
        docDate:    new Date(docDate),
        source:     "BF",
        qtyIn:      qtyInBase,
        qtyOut:     0,
        priceIn:    costPerBaseUnit,
        detail:     note ?? `ยอดยกมา ${qty} ${unitName}`,
      });
    });
    revalidatePath("/admin/stock/bf");
    return { success: true, docNo };
  } catch (err) {
    console.error("[createBF]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

const cancelBFSchema = z.object({
  bfId:       z.string().min(1),
  cancelNote: z.string().max(200).optional(),
});

export async function cancelBF(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = cancelBFSchema.safeParse({
    bfId:       formData.get("bfId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { bfId, cancelNote } = parsed.data;

  const bf = await db.balanceForward.findUnique({ where: { id: bfId } });
  if (!bf)                        return { error: "ไม่พบเอกสาร" };
  if (bf.status === "CANCELLED")  return { error: "เอกสารถูกยกเลิกไปแล้ว" };

  try {
    await dbTx(async (tx) => {
      // Delete StockCard rows for this docNo
      await tx.stockCard.deleteMany({ where: { docNo: bf.docNo, source: "BF" } });

      // Re-calculate MAVG for this product
      await recalculateStockCard(tx, bf.productId);

      // Mark BalanceForward as CANCELLED
      await tx.balanceForward.update({
        where: { id: bfId },
        data: {
          status:      "CANCELLED",
          cancelledAt: new Date(),
          cancelNote,
        },
      });
    });
    revalidatePath("/admin/stock/bf");
    return { success: true };
  } catch (err) {
    console.error("[cancelBF]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
