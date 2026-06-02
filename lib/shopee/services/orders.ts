import { db } from "@/lib/db";
import {
  NotificationSeverity,
  NotificationType,
  Prisma,
  ShopeeOrderImportStatus,
  ShopeeSyncJobType,
} from "@/lib/generated/prisma";
import { createNotification } from "@/lib/notifications";
import { createShopeeClient } from "@/lib/shopee/client";
import { getValidShopAuth } from "@/lib/shopee/services/auth";
import { withShopeeSyncLock, type SyncLockOutcome } from "@/lib/shopee/sync-lock";

/**
 * Shopee order pull → import queue (Phase E).
 *
 * IMPORTANT: this NEVER creates a Sale or touches stock. It only stages orders
 * into `ShopeeOrderImport` (raw snapshot + import status). Sale creation +
 * stock deduction is Phase F.
 *
 * Business rules (confirmed):
 *   - Import statuses: READY_TO_SHIP + PROCESSED (จ่ายแล้วรอจัดส่ง)
 *   - Lookback window: 15 days (Shopee get_order_list max window = 15 days)
 *   - Idempotent by (shopRecordId, orderSn)
 *
 * Endpoints (Shopee Open Platform v2, shop-scoped GET):
 *   - /api/v2/order/get_order_list   (per status, time_range_field=update_time)
 *   - /api/v2/order/get_order_detail (response_optional_fields=item_list,...)
 *
 * NOTE: Order field names below follow the Shopee v2 contract and are parsed
 * defensively; the full payload is preserved in `rawPayload`. Verify exact field
 * shapes against the live API before enabling Sale creation (Phase F).
 */

const ORDER_LIST_PATH = "/api/v2/order/get_order_list";
const ORDER_DETAIL_PATH = "/api/v2/order/get_order_detail";

const TARGET_STATUSES = ["READY_TO_SHIP", "PROCESSED"] as const;
const DEFAULT_LOOKBACK_DAYS = 15;
const MAX_LOOKBACK_DAYS = 15; // Shopee window limit
const LIST_PAGE_SIZE = 100;
const DETAIL_CHUNK = 50;
const MAX_LIST_PAGES = 50;
const DETAIL_OPTIONAL_FIELDS = "buyer_username,item_list,total_amount,order_status,update_time,create_time";

type OrderListEntry = { order_sn?: string; order_status?: string };
type OrderListResponse = { order_list?: OrderListEntry[]; more?: boolean; next_cursor?: string };

type OrderDetailItem = {
  item_id?: number;
  model_id?: number;
  item_sku?: string;
  model_sku?: string;
  model_quantity_purchased?: number;
};
type OrderDetail = {
  order_sn?: string;
  order_status?: string;
  buyer_username?: string;
  total_amount?: number;
  currency?: string;
  create_time?: number;
  update_time?: number;
  item_list?: OrderDetailItem[];
};
type OrderDetailResponse = { order_list?: OrderDetail[] };

export type PullOrdersResult = {
  fetched: number;
  created: number;
  needsMapping: number;
  failed: number;
};

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function toSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function lineItemKey(item: OrderDetailItem): string {
  const itemId = typeof item.item_id === "number" ? String(item.item_id) : "";
  const modelId = typeof item.model_id === "number" && item.model_id !== 0 ? String(item.model_id) : "0";
  return `${itemId}::${modelId}`;
}

type ShopAuth = { accessToken: string; shopId: number };

async function fetchOrderSns(
  client: ReturnType<typeof createShopeeClient>,
  auth: ShopAuth,
  status: string,
  timeFrom: number,
  timeTo: number,
): Promise<string[]> {
  const sns: string[] = [];
  let cursor = "";

  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const response = await client.callShop<OrderListResponse>(ORDER_LIST_PATH, auth, {
      method: "GET",
      query: {
        time_range_field: "update_time",
        time_from: timeFrom,
        time_to: timeTo,
        page_size: LIST_PAGE_SIZE,
        order_status: status,
        cursor: cursor || undefined,
      },
    });
    for (const entry of response.order_list ?? []) {
      if (entry.order_sn) sns.push(entry.order_sn);
    }
    if (!response.more || !response.next_cursor) break;
    cursor = response.next_cursor;
  }

  return sns;
}

/** Pulls eligible orders into the import queue. Idempotent; never creates Sales. */
export async function pullShopeeOrders(
  shopRecordId: string,
  options: { lookbackDays?: number } = {},
): Promise<PullOrdersResult> {
  const auth = await getValidShopAuth(shopRecordId);
  const client = createShopeeClient();

  const lookbackDays = Math.min(options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS, MAX_LOOKBACK_DAYS);
  const now = new Date();
  const timeTo = toSeconds(now);
  const timeFrom = timeTo - lookbackDays * 24 * 60 * 60;

  // Collect order_sns for each target status.
  const snSet = new Set<string>();
  for (const status of TARGET_STATUSES) {
    const sns = await fetchOrderSns(client, auth, status, timeFrom, timeTo);
    for (const sn of sns) snSet.add(sn);
  }
  const orderSns = Array.from(snSet);

  // Load existing mappings once → fast SKU-mapping check.
  const mappings = await db.shopeeProductMapping.findMany({
    where: { shopRecordId },
    select: { itemId: true, modelId: true },
  });
  const mappedKeys = new Set(mappings.map((m) => `${m.itemId}::${m.modelId}`));

  let created = 0;
  let needsMapping = 0;
  let failed = 0;

  for (const idChunk of chunk(orderSns, DETAIL_CHUNK)) {
    const detail = await client.callShop<OrderDetailResponse>(ORDER_DETAIL_PATH, auth, {
      method: "GET",
      query: { order_sn_list: idChunk.join(","), response_optional_fields: DETAIL_OPTIONAL_FIELDS },
    });

    for (const order of detail.order_list ?? []) {
      if (!order.order_sn) continue;
      try {
        const items = order.item_list ?? [];
        const hasUnmapped = items.some((item) => !mappedKeys.has(lineItemKey(item)));
        const computedStatus = hasUnmapped
          ? ShopeeOrderImportStatus.NEEDS_SKU_MAPPING
          : ShopeeOrderImportStatus.PENDING;

        const existing = await db.shopeeOrderImport.findUnique({
          where: { shopRecordId_orderSn: { shopRecordId, orderSn: order.order_sn } },
          select: { id: true, importStatus: true },
        });

        // Never downgrade an order that already advanced past the queue.
        const lockedStatuses: ShopeeOrderImportStatus[] = [
          ShopeeOrderImportStatus.IMPORTED,
          ShopeeOrderImportStatus.SKIPPED,
          ShopeeOrderImportStatus.CANCELLED_REVIEW,
        ];
        const nextStatus =
          existing && lockedStatuses.includes(existing.importStatus)
            ? existing.importStatus
            : computedStatus;

        const rawPayload = order as unknown as Prisma.InputJsonValue;
        const totalAmount =
          typeof order.total_amount === "number" ? new Prisma.Decimal(order.total_amount) : null;

        await db.shopeeOrderImport.upsert({
          where: { shopRecordId_orderSn: { shopRecordId, orderSn: order.order_sn } },
          create: {
            shopRecordId,
            orderSn: order.order_sn,
            shopeeStatus: order.order_status ?? "UNKNOWN",
            importStatus: nextStatus,
            buyerUsername: order.buyer_username ?? null,
            totalAmount,
            currency: order.currency ?? null,
            orderCreatedAt: order.create_time ? new Date(order.create_time * 1000) : null,
            orderUpdatedAt: order.update_time ? new Date(order.update_time * 1000) : null,
            rawPayload,
          },
          update: {
            shopeeStatus: order.order_status ?? "UNKNOWN",
            importStatus: nextStatus,
            buyerUsername: order.buyer_username ?? null,
            totalAmount,
            currency: order.currency ?? null,
            orderUpdatedAt: order.update_time ? new Date(order.update_time * 1000) : null,
            rawPayload,
          },
        });

        if (!existing) created += 1;
        if (nextStatus === ShopeeOrderImportStatus.NEEDS_SKU_MAPPING) needsMapping += 1;
      } catch (error) {
        failed += 1;
        console.error("[shopee] order import failed:", order.order_sn, error instanceof Error ? error.message : "unknown");
      }
    }
  }

  await db.shopeeShop.update({
    where: { id: shopRecordId },
    data: { lastOrderSyncAt: now, lastError: null },
  });

  if (created > 0) {
    await createNotification({
      type: NotificationType.SHOPEE_ORDER_IMPORTED,
      severity: NotificationSeverity.INFO,
      title: `มีออเดอร์ Shopee ใหม่ ${created} รายการ`,
      body: needsMapping > 0 ? `มี ${needsMapping} รายการต้อง map SKU ก่อน` : "พร้อมตรวจสอบใน queue",
      link: "/admin/marketplace/shopee/orders",
      entityType: "ShopeeShop",
      entityId: shopRecordId,
    }).catch(() => undefined);
  }
  if (needsMapping > 0) {
    await createNotification({
      type: NotificationType.SHOPEE_ORDER_FAILED,
      severity: NotificationSeverity.WARNING,
      title: `มีออเดอร์ Shopee ${needsMapping} รายการต้อง map SKU`,
      body: "เปิด queue เพื่อจับคู่สินค้าให้ครบก่อนสร้างบิล",
      link: "/admin/marketplace/shopee/orders?status=NEEDS_SKU_MAPPING",
      entityType: "ShopeeShop",
      entityId: shopRecordId,
      dedupeKey: `shopee-orders-needs-mapping:${shopRecordId}`,
    }).catch(() => undefined);
  }

  return { fetched: orderSns.length, created, needsMapping, failed };
}

/**
 * Order pull guarded by the sync lock — prevents a slow run from overlapping the
 * next cron tick (or a manual click) for the same shop. Returns the lock outcome.
 */
export async function pullShopeeOrdersGuarded(
  shopRecordId: string,
): Promise<SyncLockOutcome<PullOrdersResult>> {
  return withShopeeSyncLock({ shopRecordId, type: ShopeeSyncJobType.ORDER_PULL }, async () => {
    const result = await pullShopeeOrders(shopRecordId);
    return {
      value: result,
      itemsProcessed: result.fetched,
      itemsFailed: result.failed,
      meta: { created: result.created, needsMapping: result.needsMapping },
    };
  });
}

/** Pulls orders for every AUTHORIZED shop (used by the scheduled cron). */
export async function pullAllAuthorizedShops(): Promise<{
  shops: number;
  skipped: number;
  result: PullOrdersResult;
}> {
  const shops = await db.shopeeShop.findMany({
    where: { authStatus: "AUTHORIZED", syncEnabled: true },
    select: { id: true },
  });

  const total: PullOrdersResult = { fetched: 0, created: 0, needsMapping: 0, failed: 0 };
  let skipped = 0;
  for (const shop of shops) {
    try {
      const outcome = await pullShopeeOrdersGuarded(shop.id);
      if (outcome.skipped) {
        skipped += 1;
        continue;
      }
      total.fetched += outcome.result.fetched;
      total.created += outcome.result.created;
      total.needsMapping += outcome.result.needsMapping;
      total.failed += outcome.result.failed;
    } catch (error) {
      total.failed += 1;
      console.error("[shopee] pull-all failed for shop:", shop.id, error instanceof Error ? error.message : "unknown");
    }
  }
  return { shops: shops.length, skipped, result: total };
}
