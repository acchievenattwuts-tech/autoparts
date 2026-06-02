"use server";

import { revalidatePath } from "next/cache";

import {
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db } from "@/lib/db";
import {
  AuditAction,
  NotificationSeverity,
  NotificationType,
  Prisma,
  ShopeeSyncJobStatus,
  ShopeeSyncJobType,
  ShopeeSyncMode,
} from "@/lib/generated/prisma";
import { createNotification } from "@/lib/notifications";
import { requirePermission } from "@/lib/require-auth";
import { listShopeeStockReconciliation } from "@/lib/shopee/services/stock";

const STOCK_PATH = "/admin/marketplace/shopee/stock";

export type StockActionResult = { ok: true; message?: string } | { ok: false; error: string };

function parseNonNegativeInt(value: FormDataEntryValue | null, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parseOptionalNonNegativeInt(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function parseSyncMode(value: FormDataEntryValue | null): ShopeeSyncMode {
  const raw = String(value ?? "");
  if (raw === ShopeeSyncMode.DISABLED || raw === ShopeeSyncMode.PUSH_INTERNAL_TO_SHOPEE) {
    return raw;
  }
  return ShopeeSyncMode.MONITOR_ONLY;
}

export async function setShopStockBufferAction(formData: FormData): Promise<StockActionResult> {
  let session;
  try {
    session = await requirePermission("marketplace.manage");
  } catch {
    return { ok: false, error: "ไม่มีสิทธิ์จัดการ stock sync" };
  }

  const shopRecordId = String(formData.get("shopRecordId") ?? "").trim();
  if (!shopRecordId) return { ok: false, error: "ไม่พบร้าน Shopee" };
  const stockBuffer = parseNonNegativeInt(formData.get("stockBuffer"), 0);

  const updated = await db.shopeeShop.updateMany({
    where: { id: shopRecordId },
    data: { stockBuffer },
  });
  if (updated.count === 0) return { ok: false, error: "ไม่พบร้าน Shopee" };

  await safeWriteAuditLog({
    ...getAuditActorFromSession(session),
    ...(await getRequestContext()),
    action: AuditAction.UPDATE,
    entityType: "ShopeeShop",
    entityId: shopRecordId,
    meta: { event: "SHOPEE_SET_STOCK_BUFFER", stockBuffer },
  });

  revalidatePath(STOCK_PATH);
  revalidatePath("/admin/marketplace/shopee");
  return { ok: true, message: "บันทึก stock buffer ของร้านแล้ว" };
}

export async function setMappingStockSettingsAction(formData: FormData): Promise<StockActionResult> {
  let session;
  try {
    session = await requirePermission("marketplace.manage");
  } catch {
    return { ok: false, error: "ไม่มีสิทธิ์จัดการ stock sync" };
  }

  const mappingId = String(formData.get("mappingId") ?? "").trim();
  if (!mappingId) return { ok: false, error: "ไม่พบ mapping" };

  const syncMode = parseSyncMode(formData.get("syncMode"));
  const stockBuffer = parseOptionalNonNegativeInt(formData.get("stockBuffer"));

  const mapping = await db.shopeeProductMapping.findUnique({
    where: { id: mappingId },
    select: { id: true, shopRecordId: true, itemId: true, modelId: true },
  });
  if (!mapping) return { ok: false, error: "ไม่พบ mapping" };

  await db.shopeeProductMapping.update({
    where: { id: mapping.id },
    data: { syncMode, stockBuffer, lastError: null },
  });

  await safeWriteAuditLog({
    ...getAuditActorFromSession(session),
    ...(await getRequestContext()),
    action: AuditAction.UPDATE,
    entityType: "ShopeeProductMapping",
    entityId: mapping.id,
    entityRef: `${mapping.itemId}/${mapping.modelId}`,
    meta: { event: "SHOPEE_SET_STOCK_MAPPING_SETTINGS", syncMode, stockBuffer },
  });

  revalidatePath(STOCK_PATH);
  revalidatePath("/admin/marketplace/shopee/products");
  return { ok: true, message: "บันทึกการตั้งค่า mapping แล้ว" };
}

export async function recordStockReconciliationAction(shopRecordId: string): Promise<StockActionResult> {
  let session;
  try {
    session = await requirePermission("marketplace.sync");
  } catch {
    return { ok: false, error: "ไม่มีสิทธิ์สั่ง sync" };
  }

  if (!shopRecordId) return { ok: false, error: "ไม่พบร้าน Shopee" };

  const reconciliation = await listShopeeStockReconciliation(shopRecordId);
  const now = new Date();
  const attentionRows = reconciliation.rows.filter(
    (row) => row.status === "NEEDS_PUSH" || row.status === "NOT_PUSHED" || row.status === "PUSH_FAILED",
  );

  await db.shopeeSyncJob.create({
    data: {
      shopRecordId,
      type: ShopeeSyncJobType.STOCK_PUSH,
      status: ShopeeSyncJobStatus.SUCCESS,
      startedAt: now,
      finishedAt: now,
      itemsProcessed: reconciliation.summary.total,
      itemsFailed: reconciliation.summary.failed,
      attemptCount: 1,
      metaJson: {
        mode: "RECONCILIATION_ONLY",
        total: reconciliation.summary.total,
        pushEnabled: reconciliation.summary.pushEnabled,
        needsPush: reconciliation.summary.needsPush,
        failed: reconciliation.summary.failed,
      } satisfies Prisma.InputJsonObject,
    },
  });

  await db.shopeeShop.update({
    where: { id: shopRecordId },
    data: { lastStockSyncAt: now },
  });

  await safeWriteAuditLog({
    ...getAuditActorFromSession(session),
    ...(await getRequestContext()),
    action: AuditAction.UPDATE,
    entityType: "ShopeeShop",
    entityId: shopRecordId,
    meta: { event: "SHOPEE_STOCK_RECONCILE", ...reconciliation.summary },
  });

  if (attentionRows.length > 0) {
    await createNotification({
      type: NotificationType.SHOPEE_STOCK_SYNC_FAILED,
      severity: reconciliation.summary.failed > 0 ? NotificationSeverity.ERROR : NotificationSeverity.WARNING,
      title: `มีสินค้า Shopee ${attentionRows.length} รายการต้องตรวจ stock sync`,
      body: "เปิดรายงาน Shopee Stock Sync เพื่อตรวจรายการที่ยังไม่เคยส่งหรือ stock ภายในเปลี่ยนจากครั้งล่าสุด",
      link: STOCK_PATH,
      entityType: "ShopeeShop",
      entityId: shopRecordId,
      dedupeKey: `shopee-stock-reconcile:${shopRecordId}`,
    }).catch(() => undefined);
  }

  revalidatePath(STOCK_PATH);
  return {
    ok: true,
    message:
      attentionRows.length > 0
        ? `พบ ${attentionRows.length} รายการที่ต้องตรวจ`
        : "ตรวจแล้ว ยังไม่พบรายการที่ต้องส่งใหม่",
  };
}
