import { db } from "@/lib/db";
import {
  NotificationSeverity,
  NotificationType,
  Prisma,
  ShopeeOrderImportStatus,
} from "@/lib/generated/prisma";
import { createNotification } from "@/lib/notifications";
import {
  classifyShopeeReturnReviewSignal,
  getShopeeReviewPolicy,
  type ShopeeReturnReviewSignal,
} from "@/lib/shopee/returns-utils";

const RETURN_REVIEW_BATCH_SIZE = 300;

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

export type ShopeeReturnReviewOrderImport = {
  id: string;
  orderSn: string;
  shopeeStatus: string;
  rawPayload: unknown;
  returnReviewRequired?: boolean;
  returnReviewReason?: string | null;
  sale: {
    id: string;
    saleNo: string;
    status: string;
    creditNotes: { cnNo: string }[];
    receipts: { receipt: { receiptNo: string } }[];
    warranties: { claims: { claimNo: string }[] }[];
  } | null;
};

function reviewReason(signal: ShopeeReturnReviewSignal): string {
  return `${signal.kind}: ${signal.reason ?? "Shopee return/cancel/refund signal"} | policy=${getShopeeReviewPolicy(signal.kind)}`;
}

function signalFromStoredReviewReason(reason: string | null | undefined): ShopeeReturnReviewSignal {
  const rawKind = reason?.split(":")[0]?.trim().toUpperCase();
  if (rawKind === "CANCELLATION" || rawKind === "RETURN" || rawKind === "REFUND") {
    return { kind: rawKind, reason: reason ?? "Shopee return/cancel/refund signal flagged for review" };
  }
  return { kind: "RETURN", reason: reason ?? "Shopee return/cancel/refund signal flagged for review" };
}

export async function scanShopeeReturnReviewsFromImports(
  shopRecordId?: string,
): Promise<ShopeeReturnReviewScanResult> {
  let cursor: string | undefined;
  let scanned = 0;
  let flagged = 0;
  let alreadyReview = 0;
  let skipped = 0;

  while (true) {
    const orders = await db.shopeeOrderImport.findMany({
      where: {
        ...(shopRecordId ? { shopRecordId } : {}),
        importStatus: { not: ShopeeOrderImportStatus.SKIPPED },
      },
      orderBy: { id: "asc" },
      take: RETURN_REVIEW_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        orderSn: true,
        shopeeStatus: true,
        importStatus: true,
        saleId: true,
        rawPayload: true,
        lastError: true,
        returnReviewRequired: true,
        returnReviewReason: true,
      },
    });
    if (orders.length === 0) break;

    scanned += orders.length;
    cursor = orders[orders.length - 1]?.id;

    const updates: Prisma.PrismaPromise<unknown>[] = [];
    for (const order of orders) {
      const signal = classifyShopeeReturnReviewSignal(order.shopeeStatus, order.rawPayload);
      if (signal.kind === "NONE") {
        skipped += 1;
        continue;
      }

      const reason = reviewReason(signal);
      if (order.returnReviewRequired || order.importStatus === ShopeeOrderImportStatus.CANCELLED_REVIEW) {
        alreadyReview += 1;
        if (!order.returnReviewRequired) {
          updates.push(
            db.shopeeOrderImport.update({
              where: { id: order.id },
              data: {
                returnReviewRequired: true,
                returnReviewReason: order.returnReviewReason ?? reason,
                returnReviewFlaggedAt: new Date(),
                lastError: order.lastError ?? reason,
              },
            }),
          );
        }
        continue;
      }

      const shouldPreserveImportStatus =
        order.importStatus === ShopeeOrderImportStatus.IMPORTED || Boolean(order.saleId);
      updates.push(
        db.shopeeOrderImport.update({
          where: { id: order.id },
          data: {
            ...(shouldPreserveImportStatus ? {} : { importStatus: ShopeeOrderImportStatus.CANCELLED_REVIEW }),
            returnReviewRequired: true,
            returnReviewReason: reason,
            returnReviewFlaggedAt: new Date(),
            lastError: reason,
          },
        }),
      );
      flagged += 1;
    }

    if (updates.length > 0) {
      await db.$transaction(updates);
    }
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

  return { scanned, flagged, alreadyReview, skipped };
}

export async function getShopeeReturnReviewDetail(orderImportId: string): Promise<ShopeeReturnReviewDetail | null> {
  const order = await db.shopeeOrderImport.findUnique({
    where: { id: orderImportId },
    select: {
      id: true,
      orderSn: true,
      shopeeStatus: true,
      rawPayload: true,
      returnReviewRequired: true,
      returnReviewReason: true,
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
  return getShopeeReturnReviewDetailFromOrderImport(order);
}

export function getShopeeReturnReviewDetailFromOrderImport(
  order: ShopeeReturnReviewOrderImport,
): ShopeeReturnReviewDetail {
  const signal = classifyShopeeReturnReviewSignal(order.shopeeStatus, order.rawPayload);
  const effectiveSignal =
    signal.kind !== "NONE" || !order.returnReviewRequired
      ? signal
      : signalFromStoredReviewReason(order.returnReviewReason);
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
    signal: effectiveSignal,
    policy: getShopeeReviewPolicy(effectiveSignal.kind),
    saleId: order.sale?.id ?? null,
    saleNo: order.sale?.saleNo ?? null,
    referenceWarnings,
  };
}
