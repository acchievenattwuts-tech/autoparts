"use server";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const warrantySchema = z.object({
  saleId:       z.string().min(1),
  saleItemId:   z.string().min(1),
  warrantyDays: z.coerce.number().int().positive("จำนวนวันต้องมากกว่า 0"),
  note:         z.string().max(300).optional(),
});

export async function createWarranty(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("warranties.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = warrantySchema.safeParse({
    saleId:       formData.get("saleId"),
    saleItemId:   formData.get("saleItemId"),
    warrantyDays: formData.get("warrantyDays"),
    note:         formData.get("note") || undefined,
  });

  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const d = parsed.data;

  try {
    // Check no duplicate warranty on same saleItemId
    const existing = await db.warranty.findUnique({ where: { saleItemId: d.saleItemId } });
    if (existing) return { error: "รายการสินค้านี้มีการบันทึกประกันไปแล้ว" };

    const saleItem = await db.saleItem.findUnique({
      where: { id: d.saleItemId },
      select: { productId: true, sale: { select: { saleDate: true } } },
    });
    if (!saleItem) return { error: "ไม่พบรายการสินค้า" };

    const startDate = new Date(saleItem.sale.saleDate);
    const endDate   = new Date(startDate);
    endDate.setDate(endDate.getDate() + d.warrantyDays);

    await db.warranty.create({
      data: {
        saleId:       d.saleId,
        saleItemId:   d.saleItemId,
        productId:    saleItem.productId,
        warrantyDays: d.warrantyDays,
        startDate,
        endDate,
        note:         d.note,
      },
    });

    revalidatePath("/admin/warranties");
    return { success: true };
  } catch (err) {
    console.error("[createWarranty]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

export async function getSaleItems(saleId: string) {
  const session = await requirePermission("warranties.view").catch(() => null);
  if (!session?.user?.id) return null;

  const sale = await db.sale.findUnique({
    where: { id: saleId },
    select: {
      id: true,
      saleNo: true,
      saleDate: true,
      customerName: true,
      items: {
        select: {
          id: true,
          product: { select: { code: true, name: true } },
          quantity: true,
          warranty: { select: { id: true } },
        },
      },
    },
  });
  return sale;
}
