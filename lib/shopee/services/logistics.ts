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

// Forward-only ranking so a Shopee sync never reverts a more-advanced internal
// shipping status (e.g. a staff-marked DELIVERED won't be pulled back to
// OUT_FOR_DELIVERY). Tracking number + carrier still follow Shopee (authoritative).
const SHIPPING_STATUS_RANK: Record<ShippingStatus, number> = {
  [ShippingStatus.PENDING]: 0,
  [ShippingStatus.OUT_FOR_DELIVERY]: 1,
  [ShippingStatus.DELIVERED]: 2,
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
    // Only advance forward — never revert a more-advanced (e.g. manually set) status.
    if (SHIPPING_STATUS_RANK[next.shippingStatus] > SHIPPING_STATUS_RANK[order.sale.shippingStatus]) {
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

