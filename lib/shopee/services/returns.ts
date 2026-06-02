import { db } from "@/lib/db";
import {
  NotificationSeverity,
  NotificationType,
  ShopeeOrderImportStatus,
} from "@/lib/generated/prisma";
import { createNotification } from "@/lib/notifications";
import {
  classifyShopeeReturnReviewSignal,
  getShopeeReviewPolicy,
  type ShopeeReturnReviewSignal,
} from "@/lib/shopee/returns-utils";

export type ShopeeReturnReviewScanResult = {
  scanned: number;
  flagged: number;
  alreadyReview: number;
  skipped: number;
};

export type ShopeeReturnReviewDetail = {
  orderImportId: string;
  orderSn: string;
  signal: ShopeeReturnReviewSignal;
  policy: string;
  saleId: string | null;
  saleNo: string | null;
  referenceWarnings: string[];
};

export async function scanShopeeReturnReviewsFromImports(
  shopRecordId?: string,
): Promise<ShopeeReturnReviewScanResult> {
  const orders = await db.shopeeOrderImport.findMany({
    where: {
      ...(shopRecordId ? { shopRecordId } : {}),
      importStatus: { not: ShopeeOrderImportStatus.SKIPPED },
    },
    orderBy: { updatedAt: "desc" },
    take: 300,
    select: {
      id: true,
      shopRecordId: true,
      orderSn: true,
      shopeeStatus: true,
      importStatus: true,
      rawPayload: true,
    },
  });

  let flagged = 0;
  let alreadyReview = 0;
  let skipped = 0;

  for (const order of orders) {
    const signal = classifyShopeeReturnReviewSignal(order.shopeeStatus, order.rawPayload);
    if (signal.kind === "NONE") {
      skipped += 1;
      continue;
    }
    if (order.importStatus === ShopeeOrderImportStatus.CANCELLED_REVIEW) {
      alreadyReview += 1;
      continue;
    }

    await db.shopeeOrderImport.update({
      where: { id: order.id },
      data: {
        importStatus: ShopeeOrderImportStatus.CANCELLED_REVIEW,
        lastError: `${signal.kind}: ${signal.reason ?? "Shopee return/cancel/refund signal"} | policy=${getShopeeReviewPolicy(signal.kind)}`,
      },
    });
    flagged += 1;
  }

  if (flagged > 0 && shopRecordId) {
    await createNotification({
      type: NotificationType.SHOPEE_RETURN_REVIEW,
      severity: NotificationSeverity.WARNING,
      title: `Shopee return/cancel/refund ต้อง review ${flagged} รายการ`,
      body: "ระบบจัดเข้าคิว review เท่านั้น ยังไม่ยกเลิก Sale หรือสร้าง CN อัตโนมัติ",
      link: "/admin/marketplace/shopee/orders?status=CANCELLED_REVIEW",
      entityType: "ShopeeShop",
      entityId: shopRecordId,
      dedupeKey: `shopee-return-review:${shopRecordId}`,
    }).catch(() => undefined);
  }

  return { scanned: orders.length, flagged, alreadyReview, skipped };
}

export async function getShopeeReturnReviewDetail(orderImportId: string): Promise<ShopeeReturnReviewDetail | null> {
  const order = await db.shopeeOrderImport.findUnique({
    where: { id: orderImportId },
    select: {
      id: true,
      orderSn: true,
      shopeeStatus: true,
      rawPayload: true,
      sale: {
        select: {
          id: true,
          saleNo: true,
          status: true,
          creditNotes: { where: { status: "ACTIVE" }, select: { cnNo: true } },
          receipts: {
            where: { receipt: { status: "ACTIVE" } },
            select: { receipt: { select: { receiptNo: true } } },
          },
          warranties: {
            select: {
              claims: {
                where: { status: { not: "CANCELLED" } },
                select: { claimNo: true },
              },
            },
          },
        },
      },
    },
  });
  if (!order) return null;

  const signal = classifyShopeeReturnReviewSignal(order.shopeeStatus, order.rawPayload);
  const referenceWarnings: string[] = [];
  if (!order.sale) {
    referenceWarnings.push("ยังไม่มี Sale ในระบบ จึงไม่ควรสร้าง CN/คืน stock อัตโนมัติ");
  } else {
    if (order.sale.status === "CANCELLED") referenceWarnings.push("Sale นี้ถูกยกเลิกแล้ว");
    if (order.sale.creditNotes.length > 0) {
      referenceWarnings.push(`มี CN active: ${order.sale.creditNotes.map((cn) => cn.cnNo).join(", ")}`);
    }
    if (order.sale.receipts.length > 0) {
      referenceWarnings.push(`มีใบเสร็จ active: ${order.sale.receipts.map((ri) => ri.receipt.receiptNo).join(", ")}`);
    }
    const claims = order.sale.warranties.flatMap((w) => w.claims);
    if (claims.length > 0) {
      referenceWarnings.push(`มีใบเคลม active: ${claims.map((claim) => claim.claimNo).join(", ")}`);
    }
  }

  if (referenceWarnings.length === 0) {
    referenceWarnings.push("ยังไม่พบ reference-chain blocker จาก Sale/CN/Receipt/Claim แต่ยังต้องตรวจรายการคืนจริงก่อนทำ CN");
  }

  return {
    orderImportId: order.id,
    orderSn: order.orderSn,
    signal,
    policy: getShopeeReviewPolicy(signal.kind),
    saleId: order.sale?.id ?? null,
    saleNo: order.sale?.saleNo ?? null,
    referenceWarnings,
  };
}

