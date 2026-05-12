"use server";

import { AuditAction } from "@/lib/generated/prisma";
import { safeWriteAuditLog, writeAuditLogTx } from "@/lib/audit-log";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { z } from "zod";

const destPinSchema = z.object({
  saleId:    z.string().min(1).max(50),
  latitude:  z.number().finite().gte(-90).lte(90),
  longitude: z.number().finite().gte(-180).lte(180),
});

export async function updateSaleDestinationPin(
  saleId: string,
  latitude: number,
  longitude: number,
): Promise<{ success: boolean; error?: string }> {
  await requirePermission("delivery.update");

  const parsed = destPinSchema.safeParse({ saleId, latitude, longitude });
  if (!parsed.success) return { success: false, error: "ข้อมูลตำแหน่งไม่ถูกต้อง" };

  try {
    await db.sale.update({
      where: { id: parsed.data.saleId },
      data: { destLatitude: parsed.data.latitude, destLongitude: parsed.data.longitude },
    });
    await safeWriteAuditLog({
      action: AuditAction.UPDATE,
      entityType: "Sale",
      entityRef: parsed.data.saleId,
      after: { destLatitude: parsed.data.latitude, destLongitude: parsed.data.longitude },
    });
    return { success: true };
  } catch {
    return { success: false, error: "เกิดข้อผิดพลาด กรุณาลองใหม่" };
  }
}

const locationSchema = z.object({
  saleIds: z.array(z.string().min(1).max(50)).min(1).max(50),
  latitude: z.number().finite().gte(-90).lte(90),
  longitude: z.number().finite().gte(-180).lte(180),
  accuracy: z.number().finite().positive(),
});

export async function updateDriverLocationAction(
  saleIds: string[],
  latitude: number,
  longitude: number,
  accuracy: number,
): Promise<{ success: boolean; error?: string }> {
  const session = await requirePermission("delivery.update");

  const parsed = locationSchema.safeParse({ saleIds, latitude, longitude, accuracy });
  if (!parsed.success) {
    return { success: false, error: "ข้อมูลตำแหน่งไม่ถูกต้อง" };
  }

  const { saleIds: validSaleIds, latitude: lat, longitude: lon, accuracy: acc } = parsed.data;

  try {
    // Verify all saleIds belong to active OUT_FOR_DELIVERY sales for this driver
    const validSales = await db.sale.findMany({
      where: {
        id: { in: validSaleIds },
        deliveryStaffId: session.user.id,
        shippingStatus: "OUT_FOR_DELIVERY",
        status: "ACTIVE",
      },
      select: { id: true, saleNo: true },
    });

    if (validSales.length === 0) {
      return { success: false, error: "ไม่พบออเดอร์ที่กำลังจัดส่ง" };
    }

    // Reject if any saleId is not assigned to this driver (security: prevent spoofing)
    if (validSales.length !== validSaleIds.length) {
      return { success: false, error: "ออเดอร์บางรายการไม่ได้ assign ให้คุณ" };
    }

    // Upsert tracking for each valid sale (transaction ensures atomicity)
    await db.$transaction(async (tx) => {
      for (const sale of validSales) {
        await tx.deliveryTracking.upsert({
          where: { saleId: sale.id },
          create: { saleId: sale.id, latitude: lat, longitude: lon, accuracy: acc },
          update: { latitude: lat, longitude: lon, accuracy: acc },
        });
      }

      // Write audit log within transaction for consistency
      await writeAuditLogTx(tx, {
        action: AuditAction.UPDATE,
        entityType: "DeliveryTracking",
        entityRef: validSales.map((s) => s.saleNo).join(", "),
        after: { latitude: lat, longitude: lon, accuracy: acc, saleCount: validSales.length },
      });
    });

    return { success: true };
  } catch {
    return { success: false, error: "เกิดข้อผิดพลาด กรุณาลองใหม่" };
  }
}
