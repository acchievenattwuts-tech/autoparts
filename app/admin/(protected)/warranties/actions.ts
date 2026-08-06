"use server";

import {
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";
import { requireAnyPermission, requirePermission } from "@/lib/require-auth";
import {
  addThailandDays,
  parseDateOnlyToStartOfDay,
  startOfThailandDay,
} from "@/lib/th-date";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const withSaleSchema = z.object({
  mode:         z.literal("WITH_SALE"),
  saleId:       z.string().min(1, "กรุณาเลือกใบขาย"),
  saleItemId:   z.string().min(1, "กรุณาเลือกรายการสินค้า"),
  warrantyDays: z.coerce.number().int().positive("จำนวนวันต้องมากกว่า 0"),
  note:         z.string().max(300).optional(),
});

const noSaleSchema = z.object({
  mode:         z.literal("NO_SALE"),
  customerId:   z.string().min(1, "กรุณาเลือกลูกค้า"),
  productId:    z.string().min(1, "กรุณาเลือกสินค้า"),
  startDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่เริ่มประกันไม่ถูกต้อง"),
  warrantyDays: z.coerce.number().int().positive("จำนวนวันต้องมากกว่า 0"),
  note:         z.string().max(300).optional(),
});

const warrantySchema = z.discriminatedUnion("mode", [withSaleSchema, noSaleSchema]);

export async function createWarranty(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("warranties.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const requestContext = await getRequestContext();
  const rawMode = formData.get("mode");
  const mode = rawMode === "NO_SALE" ? "NO_SALE" : "WITH_SALE";

  const parsed = warrantySchema.safeParse(
    mode === "NO_SALE"
      ? {
          mode,
          customerId:   formData.get("customerId"),
          productId:    formData.get("productId"),
          startDate:    formData.get("startDate"),
          warrantyDays: formData.get("warrantyDays"),
          note:         formData.get("note") || undefined,
        }
      : {
          mode,
          saleId:       formData.get("saleId"),
          saleItemId:   formData.get("saleItemId"),
          warrantyDays: formData.get("warrantyDays"),
          note:         formData.get("note") || undefined,
        },
  );

  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const d = parsed.data;

  try {
    if (d.mode === "WITH_SALE") {
      const existing = await db.warranty.findFirst({ where: { saleItemId: d.saleItemId, unitSeq: 1 } });
      if (existing) return { error: "รายการสินค้านี้มีการบันทึกประกันไปแล้ว" };

      const saleItem = await db.saleItem.findUnique({
        where: { id: d.saleItemId },
        select: {
          productId: true,
          quantity: true,
          sale: { select: { id: true, saleDate: true, customerId: true, customerName: true } },
          product: { select: { isLotControl: true } },
          lotItems: { orderBy: { id: "asc" }, select: { lotNo: true } },
        },
      });
      if (!saleItem) return { error: "ไม่พบรายการสินค้า" };

      const derivedSaleId = saleItem.sale.id;
      const lotNoSnapshot =
        saleItem.product.isLotControl && saleItem.lotItems.length === 1
          ? saleItem.lotItems[0]?.lotNo ?? null
          : null;

      if (saleItem.product.isLotControl && !lotNoSnapshot) {
        return { error: "ไม่สามารถสร้างประกันแบบ manual ได้ เพราะไม่พบ lot snapshot ที่ชัดเจนของรายการขายนี้" };
      }

      const startDate = startOfThailandDay(saleItem.sale.saleDate);
      const endDate = addThailandDays(startDate, d.warrantyDays);

      const warranty = await db.warranty.create({
        data: {
          saleId:       derivedSaleId,
          saleItemId:   d.saleItemId,
          productId:    saleItem.productId,
          customerId:   saleItem.sale.customerId ?? null,
          customerName: saleItem.sale.customerName ?? null,
          lotNo:        lotNoSnapshot,
          warrantyDays: d.warrantyDays,
          startDate,
          endDate,
          note:         d.note,
          createdVia:   "MANUAL",
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
          mode: "WITH_SALE",
          saleId: derivedSaleId,
          saleItemId: d.saleItemId,
          productId: saleItem.productId,
          customerId: saleItem.sale.customerId ?? null,
          customerName: saleItem.sale.customerName ?? null,
          lotNo: lotNoSnapshot,
          warrantyDays: d.warrantyDays,
          startDate,
          endDate,
          note: d.note ?? null,
        },
      });

      revalidatePath("/admin/warranties");
      return { success: true };
    }

    // NO_SALE branch
    const [customer, product] = await Promise.all([
      db.customer.findUnique({
        where: { id: d.customerId },
        select: { id: true, name: true, isActive: true },
      }),
      db.product.findUnique({
        where: { id: d.productId },
        select: { id: true, isActive: true, isLotControl: true },
      }),
    ]);
    if (!customer || !customer.isActive) return { error: "ไม่พบลูกค้าในระบบ" };
    if (!product || !product.isActive) return { error: "ไม่พบสินค้าในระบบ" };
    if (product.isLotControl) {
      return { error: "สินค้าควบคุม Lot ต้องสร้างประกันผ่านใบขายเท่านั้น" };
    }

    const startDate = parseDateOnlyToStartOfDay(d.startDate);
    const endDate = addThailandDays(startDate, d.warrantyDays);

    const warranty = await db.warranty.create({
      data: {
        saleId:       null,
        saleItemId:   null,
        productId:    product.id,
        customerId:   customer.id,
        customerName: customer.name,
        lotNo:        null,
        warrantyDays: d.warrantyDays,
        startDate,
        endDate,
        note:         d.note,
        createdVia:   "MANUAL",
      },
    });

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.CREATE,
      entityType: "Warranty",
      entityId: warranty.id,
      entityRef: `manual:${customer.id}:${product.id}`,
      after: {
        id: warranty.id,
        mode: "NO_SALE",
        productId: product.id,
        customerId: customer.id,
        customerName: customer.name,
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

export async function cancelWarranty(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("warranties.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์ยกเลิกประกัน" };

  const warrantyId = formData.get("warrantyId");
  const cancelNote = formData.get("cancelNote");
  if (!warrantyId || typeof warrantyId !== "string") {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }

  const requestContext = await getRequestContext();

  try {
    const warranty = await db.warranty.findUnique({
      where: { id: warrantyId },
      select: {
        id: true,
        createdVia: true,
        saleId: true,
        saleItemId: true,
        productId: true,
        customerId: true,
        customerName: true,
        warrantyDays: true,
        startDate: true,
        endDate: true,
        unitSeq: true,
        lotNo: true,
        note: true,
        claims: {
          where: { status: { not: "CANCELLED" } },
          select: { id: true, claimNo: true },
        },
      },
    });

    if (!warranty) return { error: "ไม่พบรายการประกัน" };

    if (warranty.createdVia !== "MANUAL") {
      return {
        error:
          "ไม่สามารถยกเลิกได้ — ประกันรายการนี้ถูกสร้างอัตโนมัติจากใบขาย หากต้องการยกเลิก ให้ยกเลิกใบขายแทน",
      };
    }

    if (warranty.claims.length > 0) {
      const refList = warranty.claims.map((c) => c.claimNo).join(", ");
      return {
        error: `ไม่สามารถยกเลิกได้ — ยังมีใบเคลมที่ active อ้างอิงอยู่: ${refList}`,
      };
    }

    await db.warranty.delete({ where: { id: warrantyId } });

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.CANCEL,
      entityType: "Warranty",
      entityId: warranty.id,
      entityRef: warranty.saleItemId
        ? `${warranty.saleId}:${warranty.saleItemId}`
        : `manual:${warranty.customerId}:${warranty.productId}`,
      before: {
        id: warranty.id,
        createdVia: warranty.createdVia,
        saleId: warranty.saleId,
        saleItemId: warranty.saleItemId,
        productId: warranty.productId,
        customerId: warranty.customerId,
        customerName: warranty.customerName,
        warrantyDays: warranty.warrantyDays,
        startDate: warranty.startDate,
        endDate: warranty.endDate,
        unitSeq: warranty.unitSeq,
        lotNo: warranty.lotNo,
        note: warranty.note,
      },
      after: typeof cancelNote === "string" && cancelNote.trim() ? { cancelNote: cancelNote.trim() } : undefined,
    });

    revalidatePath("/admin/warranties");
    return { success: true };
  } catch (err) {
    console.error("[cancelWarranty]", err);
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
        orderBy: { lineNo: "asc" },
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
