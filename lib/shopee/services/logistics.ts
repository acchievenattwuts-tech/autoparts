import { db } from "@/lib/db";
import { ShippingMethod, ShippingStatus } from "@/lib/generated/prisma";
import {
  extractShopeeCarrier,
  extractShopeeTrackingNo,
  mapShopeeCarrierToShippingMethod,
  mapShopeeOrderStatusToShippingStatus,
} from "@/lib/shopee/logistics-utils";

export type ShopeeLogisticsSyncResult = {
  scanned: number;
  updated: number;
  withTracking: number;
  skipped: number;
};

type SyncableShopeeOrder = {
  id: string;
  orderSn: string;
  shopeeStatus: string;
  rawPayload: unknown;
  sale: {
    id: string;
    shippingMethod: ShippingMethod;
    shippingStatus: ShippingStatus;
    trackingNo: string | null;
  } | null;
};

function resolveNextShipping(raw: SyncableShopeeOrder) {
  const trackingNo = extractShopeeTrackingNo(raw.rawPayload);
  const carrier = extractShopeeCarrier(raw.rawPayload);
  const shippingMethod = mapShopeeCarrierToShippingMethod(carrier);
  const shippingStatus = mapShopeeOrderStatusToShippingStatus(raw.shopeeStatus, trackingNo);

  return {
    trackingNo,
    shippingMethod,
    shippingStatus,
  };
}

export async function syncShopeeLogisticsFromImports(
  shopRecordId?: string,
): Promise<ShopeeLogisticsSyncResult> {
  const orders = await db.shopeeOrderImport.findMany({
    where: {
      importStatus: "IMPORTED",
      saleId: { not: null },
      ...(shopRecordId ? { shopRecordId } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      orderSn: true,
      shopeeStatus: true,
      rawPayload: true,
      sale: {
        select: {
          id: true,
          shippingMethod: true,
          shippingStatus: true,
          trackingNo: true,
        },
      },
    },
  });

  let updated = 0;
  let withTracking = 0;
  let skipped = 0;

  for (const order of orders) {
    if (!order.sale) {
      skipped += 1;
      continue;
    }

    const next = resolveNextShipping(order);
    if (next.trackingNo) withTracking += 1;

    const data: {
      trackingNo?: string | null;
      shippingMethod?: ShippingMethod;
      shippingStatus?: ShippingStatus;
    } = {};

    if (next.trackingNo && next.trackingNo !== order.sale.trackingNo) {
      data.trackingNo = next.trackingNo;
    }
    if (next.shippingMethod !== ShippingMethod.NONE && next.shippingMethod !== order.sale.shippingMethod) {
      data.shippingMethod = next.shippingMethod;
    }
    if (next.shippingStatus !== order.sale.shippingStatus) {
      data.shippingStatus = next.shippingStatus;
    }

    if (Object.keys(data).length === 0) {
      skipped += 1;
      continue;
    }

    await db.sale.update({
      where: { id: order.sale.id },
      data,
    });
    updated += 1;
  }

  return { scanned: orders.length, updated, withTracking, skipped };
}

