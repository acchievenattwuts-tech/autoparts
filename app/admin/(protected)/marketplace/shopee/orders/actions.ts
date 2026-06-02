"use server";

import { revalidatePath } from "next/cache";

import {
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { AuditAction, ShopeeSyncJobStatus, ShopeeSyncJobType } from "@/lib/generated/prisma";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { pullShopeeOrders, type PullOrdersResult } from "@/lib/shopee/services/orders";
import { createSaleFromShopeeOrder } from "@/lib/shopee/services/create-sale";
import { syncShopeeLogisticsFromImports, type ShopeeLogisticsSyncResult } from "@/lib/shopee/services/logistics";
import { scanShopeeReturnReviewsFromImports, type ShopeeReturnReviewScanResult } from "@/lib/shopee/services/returns";

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

export type CreateBillActionResult =
  | { ok: true; saleId: string; saleNo: string }
  | { ok: false; error: string };

export type SyncLogisticsActionResult =
  | { ok: true; result: ShopeeLogisticsSyncResult }
  | { ok: false; error: string };

export type ScanReturnReviewActionResult =
  | { ok: true; result: ShopeeReturnReviewScanResult }
  | { ok: false; error: string };

/** Creates the real Sale from a queued Shopee order (human-approved). */
export async function createSaleFromOrderAction(orderImportId: string): Promise<CreateBillActionResult> {
  let session;
  try {
    session = await requirePermission("marketplace.manage");
  } catch {
    return { ok: false, error: "ไม่มีสิทธิ์สร้างบิล" };
  }

  if (!orderImportId) return { ok: false, error: "ไม่พบออเดอร์" };

  const result = await createSaleFromShopeeOrder({
    orderImportId,
    approverUserId: session.user.id,
    actor: getAuditActorFromSession(session),
  });

  if (!result.ok) return result;

  revalidatePath(ORDERS_PATH);
  revalidatePath("/admin/sales");
  revalidatePath("/admin");
  return { ok: true, saleId: result.saleId, saleNo: result.saleNo };
}

/** Syncs delivery fields from Shopee order snapshots into created Shopee Sales. */
export async function syncLogisticsFromOrdersAction(shopRecordId: string): Promise<SyncLogisticsActionResult> {
  let session;
  try {
    session = await requirePermission("marketplace.sync");
  } catch {
    return { ok: false, error: "ไม่มีสิทธิ์สั่ง sync" };
  }

  if (!shopRecordId) return { ok: false, error: "ไม่พบร้าน" };

  const startedAt = new Date();
  try {
    const result = await syncShopeeLogisticsFromImports(shopRecordId);

    await db.shopeeSyncJob.create({
      data: {
        shopRecordId,
        type: ShopeeSyncJobType.LOGISTICS_SYNC,
        status: ShopeeSyncJobStatus.SUCCESS,
        startedAt,
        finishedAt: new Date(),
        itemsProcessed: result.scanned,
        itemsFailed: 0,
        attemptCount: 1,
        metaJson: {
          source: "SHOPEE_ORDER_IMPORT_SNAPSHOT",
          updated: result.updated,
          withTracking: result.withTracking,
          skipped: result.skipped,
        },
      },
    });

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...(await getRequestContext()),
      action: AuditAction.UPDATE,
      entityType: "ShopeeShop",
      entityId: shopRecordId,
      meta: { event: "SHOPEE_LOGISTICS_SYNC", source: "SHOPEE", ...result },
    });

    revalidatePath(ORDERS_PATH);
    revalidatePath("/admin/delivery");
    revalidatePath("/admin/sales");
    return { ok: true, result };
  } catch (error) {
    console.error("[shopee] logistics sync failed:", error instanceof Error ? error.message : "unknown");
    await db.shopeeSyncJob.create({
      data: {
        shopRecordId,
        type: ShopeeSyncJobType.LOGISTICS_SYNC,
        status: ShopeeSyncJobStatus.FAILED,
        startedAt,
        finishedAt: new Date(),
        itemsProcessed: 0,
        itemsFailed: 1,
        attemptCount: 1,
        lastError: error instanceof Error ? error.message : "unknown",
        metaJson: { source: "SHOPEE_ORDER_IMPORT_SNAPSHOT" },
      },
    }).catch(() => undefined);
    return { ok: false, error: "sync tracking ไม่สำเร็จ" };
  }
}

/** Flags Shopee cancel/refund/return snapshots for manual review only. */
export async function scanReturnReviewsAction(shopRecordId: string): Promise<ScanReturnReviewActionResult> {
  let session;
  try {
    session = await requirePermission("marketplace.sync");
  } catch {
    return { ok: false, error: "ไม่มีสิทธิ์สั่ง sync" };
  }

  if (!shopRecordId) return { ok: false, error: "ไม่พบร้าน" };

  try {
    const result = await scanShopeeReturnReviewsFromImports(shopRecordId);

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...(await getRequestContext()),
      action: AuditAction.UPDATE,
      entityType: "ShopeeShop",
      entityId: shopRecordId,
      meta: { event: "SHOPEE_RETURN_REVIEW_SCAN", source: "SHOPEE", ...result },
    });

    revalidatePath(ORDERS_PATH);
    revalidatePath("/admin/notifications");
    return { ok: true, result };
  } catch (error) {
    console.error("[shopee] return review scan failed:", error instanceof Error ? error.message : "unknown");
    return { ok: false, error: "scan cancel/refund/return ไม่สำเร็จ" };
  }
}
