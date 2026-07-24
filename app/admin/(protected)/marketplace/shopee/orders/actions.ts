"use server";

import { revalidatePath } from "next/cache";

import {
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { AuditAction, ShopeeSyncJobType } from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";
import { createShopeeFeeExpense, type CreateShopeeFeeExpenseResult } from "@/lib/shopee/services/escrow";
import { createSaleFromShopeeOrder, type LotSelectionMap } from "@/lib/shopee/services/create-sale";
import { revalidateProfitDashboardCache } from "@/lib/profit-cache";
import { syncShopeeLogisticsFromImports, type ShopeeLogisticsSyncResult } from "@/lib/shopee/services/logistics";
import { pullShopeeOrdersGuarded, type PullOrdersResult } from "@/lib/shopee/services/orders";
import { scanShopeeReturnReviewsFromImports, type ShopeeReturnReviewScanResult } from "@/lib/shopee/services/returns";
import { withShopeeSyncLock } from "@/lib/shopee/sync-lock";

const ORDERS_PATH = "/admin/marketplace/shopee/orders";

export type PullActionResult =
  | { ok: true; result: PullOrdersResult }
  | { ok: false; error: string };

export type CreateBillActionResult =
  | { ok: true; saleId: string; saleNo: string }
  | { ok: false; error: string };

export type SyncLogisticsActionResult =
  | { ok: true; result: ShopeeLogisticsSyncResult }
  | { ok: false; error: string };

export type ScanReturnReviewActionResult =
  | { ok: true; result: ShopeeReturnReviewScanResult }
  | { ok: false; error: string };

export type CreateFeeExpenseActionResult = CreateShopeeFeeExpenseResult;

export async function pullOrdersNowAction(shopRecordId: string): Promise<PullActionResult> {
  let session;
  try {
    session = await requirePermission("marketplace.sync");
  } catch {
    return { ok: false, error: "ไม่มีสิทธิ์สั่ง sync" };
  }

  if (!shopRecordId) return { ok: false, error: "ไม่พบร้าน" };

  try {
    const outcome = await pullShopeeOrdersGuarded(shopRecordId);
    if (outcome.skipped) {
      return { ok: false, error: "กำลังดึงออเดอร์อยู่ กรุณารอสักครู่แล้วลองใหม่" };
    }
    const result = outcome.result;

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

export async function createSaleFromOrderAction(
  orderImportId: string,
  lotSelections?: LotSelectionMap,
): Promise<CreateBillActionResult> {
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
    lotSelections,
    actor: getAuditActorFromSession(session),
  });

  if (!result.ok) return result;

  revalidateProfitDashboardCache();
  revalidatePath(ORDERS_PATH);
  revalidatePath("/admin/sales");
  revalidatePath("/admin");
  return { ok: true, saleId: result.saleId, saleNo: result.saleNo };
}

export async function createFeeExpenseFromOrderAction(orderImportId: string): Promise<CreateFeeExpenseActionResult> {
  let session;
  try {
    session = await requirePermission("marketplace.manage");
    await requirePermission("expenses.create");
  } catch {
    return { ok: false, error: "ไม่มีสิทธิ์สร้างค่าใช้จ่าย Shopee" };
  }

  if (!orderImportId) return { ok: false, error: "ไม่พบออเดอร์" };

  const result = await createShopeeFeeExpense({
    orderImportId,
    userId: session.user.id,
  });

  if (!result.ok) return result;

  await safeWriteAuditLog({
    ...getAuditActorFromSession(session),
    ...(await getRequestContext()),
    action: AuditAction.CREATE,
    entityType: "Expense",
    entityId: result.expenseId,
    entityRef: result.expenseNo,
    meta: { event: "SHOPEE_FEE_EXPENSE_CREATE", orderImportId, reused: result.reused },
  });

  revalidateProfitDashboardCache();
  revalidatePath(ORDERS_PATH);
  revalidatePath(`/admin/marketplace/shopee/orders/${orderImportId}`);
  revalidatePath("/admin/expenses");
  revalidatePath("/admin");
  return result;
}

export async function syncLogisticsFromOrdersAction(shopRecordId: string): Promise<SyncLogisticsActionResult> {
  let session;
  try {
    session = await requirePermission("marketplace.sync");
  } catch {
    return { ok: false, error: "ไม่มีสิทธิ์สั่ง sync" };
  }

  if (!shopRecordId) return { ok: false, error: "ไม่พบร้าน" };

  try {
    const outcome = await withShopeeSyncLock(
      { shopRecordId, type: ShopeeSyncJobType.LOGISTICS_SYNC },
      async () => {
        const result = await syncShopeeLogisticsFromImports(shopRecordId);
        return {
          value: result,
          itemsProcessed: result.scanned,
          itemsFailed: 0,
          meta: {
            source: "SHOPEE_ORDER_IMPORT_SNAPSHOT",
            updated: result.updated,
            withTracking: result.withTracking,
            skipped: result.skipped,
          },
        };
      },
    );
    if (outcome.skipped) return { ok: false, error: "sync tracking กำลังทำงานอยู่" };
    const result = outcome.result;

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
    return { ok: false, error: "sync tracking ไม่สำเร็จ" };
  }
}

export async function scanReturnReviewsAction(shopRecordId: string): Promise<ScanReturnReviewActionResult> {
  let session;
  try {
    session = await requirePermission("marketplace.sync");
  } catch {
    return { ok: false, error: "ไม่มีสิทธิ์สั่ง sync" };
  }

  if (!shopRecordId) return { ok: false, error: "ไม่พบร้าน" };

  try {
    const outcome = await withShopeeSyncLock(
      { shopRecordId, type: ShopeeSyncJobType.RETURN_REVIEW_SCAN },
      async () => {
        const result = await scanShopeeReturnReviewsFromImports(shopRecordId);
        return {
          value: result,
          itemsProcessed: result.scanned,
          itemsFailed: 0,
          meta: {
            source: "SHOPEE_ORDER_IMPORT_SNAPSHOT",
            flagged: result.flagged,
            alreadyReview: result.alreadyReview,
            skipped: result.skipped,
          },
        };
      },
    );
    if (outcome.skipped) return { ok: false, error: "scan cancel/refund กำลังทำงานอยู่" };
    const result = outcome.result;

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
