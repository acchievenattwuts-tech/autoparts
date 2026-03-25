"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/require-auth";
import { writeStockCard } from "@/lib/stock-card";
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
  try { await requireAuth(); } catch { return { error: "ไม่มีสิทธิ์เข้าถึง" }; }

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
    await db.$transaction(async (tx) => {
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
  } catch {
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
