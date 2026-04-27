"use server";

import {
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";
import { requireAnyPermission, requirePermission } from "@/lib/require-auth";
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

  const requestContext = await getRequestContext();
  const parsed = warrantySchema.safeParse({
    saleId:       formData.get("saleId"),
    saleItemId:   formData.get("saleItemId"),
    warrantyDays: formData.get("warrantyDays"),
    note:         formData.get("note") || undefined,
  });

  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const d = parsed.data;

  try {
    // Check no duplicate warranty on same saleItemId (unitSeq defaults to 1 for legacy single-unit creation)
    const existing = await db.warranty.findFirst({ where: { saleItemId: d.saleItemId, unitSeq: 1 } });
    if (existing) return { error: "รายการสินค้านี้มีการบันทึกประกันไปแล้ว" };

    const saleItem = await db.saleItem.findUnique({
      where: { id: d.saleItemId },
      select: {
        productId: true,
        quantity: true,
        sale: { select: { id: true, saleDate: true } },
        product: { select: { isLotControl: true } },
        lotItems: { select: { lotNo: true } },
      },
    });
    if (!saleItem) return { error: "ไม่พบรายการสินค้า" };

    const derivedSaleId = saleItem.sale.id;
    const lotNoSnapshot =
      saleItem.product.isLotControl && saleItem.lotItems.length === 1 ? saleItem.lotItems[0]?.lotNo ?? null : null;

    if (saleItem.product.isLotControl && !lotNoSnapshot) {
      return { error: "ไม่สามารถสร้างประกันแบบ manual ได้ เพราะไม่พบ lot snapshot ที่ชัดเจนของรายการขายนี้" };
    }

    const startDate = new Date(saleItem.sale.saleDate);
    const endDate   = new Date(startDate);
    endDate.setDate(endDate.getDate() + d.warrantyDays);

    const warranty = await db.warranty.create({
      data: {
        saleId:       derivedSaleId,
        saleItemId:   d.saleItemId,
        productId:    saleItem.productId,
        lotNo:        lotNoSnapshot,
        warrantyDays: d.warrantyDays,
        startDate,
        endDate,
        note:         d.note,
      },
    });

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.CREATE,
      entityType: "Warranty",
      entityId: warranty.id,
      entityRef: `${derivedSaleId}:${d.saleItemId}`,
      after: {
        id: warranty.id,
        saleId: derivedSaleId,
        saleItemId: d.saleItemId,
        productId: saleItem.productId,
        lotNo: lotNoSnapshot,
        warrantyDays: d.warrantyDays,
        startDate,
        endDate,
        note: d.note ?? null,
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
  const session = await requireAnyPermission(["warranties.view", "warranties.create"]).catch(
    () => null,
  );
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
          warranties: { select: { id: true } },
        },
      },
    },
  });
  return sale;
}
