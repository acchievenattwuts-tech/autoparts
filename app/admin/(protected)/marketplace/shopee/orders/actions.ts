"use server";

import { revalidatePath } from "next/cache";

import {
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { AuditAction } from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";
import { pullShopeeOrders, type PullOrdersResult } from "@/lib/shopee/services/orders";

const ORDERS_PATH = "/admin/marketplace/shopee/orders";

export type PullActionResult =
  | { ok: true; result: PullOrdersResult }
  | { ok: false; error: string };

export async function pullOrdersNowAction(shopRecordId: string): Promise<PullActionResult> {
  let session;
  try {
    session = await requirePermission("marketplace.sync");
  } catch {
    return { ok: false, error: "ไม่มีสิทธิ์สั่ง sync" };
  }

  if (!shopRecordId) {
    return { ok: false, error: "ไม่พบร้าน" };
  }

  try {
    const result = await pullShopeeOrders(shopRecordId);

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...(await getRequestContext()),
      action: AuditAction.UPDATE,
      entityType: "ShopeeShop",
      entityId: shopRecordId,
      meta: { event: "SHOPEE_ORDER_PULL", ...result },
    });

    revalidatePath(ORDERS_PATH);
    return { ok: true, result };
  } catch (error) {
    console.error("[shopee] manual pull failed:", error instanceof Error ? error.message : "unknown");
    return { ok: false, error: "ดึงออเดอร์ไม่สำเร็จ — ตรวจสอบการเชื่อมต่อร้าน" };
  }
}
