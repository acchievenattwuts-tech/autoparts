import { randomUUID } from "node:crypto";
import { getContentConfig } from "@/lib/content-config";
import type { Prisma } from "@/lib/generated/prisma";
import { buildDeliveryLineCard, buildDeliveryOrderUrl, type DeliveryLineEvent } from "@/lib/line-delivery-card";
import { getDeliveryNotificationSkipReason } from "@/lib/line-delivery-policy";
import { LINE_DELIVERY_NOTIFICATIONS_KEY, parseLineDeliveryNotificationsEnabled } from "@/lib/line-delivery-settings";
import { defaultSiteConfig } from "@/lib/site-config";

const notificationSaleSelect = {
  id: true, saleNo: true, status: true, fulfillmentType: true, shippingMethod: true,
  shippingStatus: true, customerId: true,
  customer: { select: { id: true, name: true, isActive: true, phone: true, lineUserId: true, lineLinkedAt: true } },
} satisfies Prisma.SaleSelect;

// Runs inside the status transaction. A skipped event stays sealed forever too.
export const enqueueSaleDeliveryLineNotification = async (
  tx: Prisma.TransactionClient, saleId: string, previousStatus: string, eventAt: Date,
): Promise<string | null> => {
  try {
    const sale = await tx.sale.findUnique({ where: { id: saleId }, select: notificationSaleSelect });
    if (!sale || sale.shippingStatus === previousStatus || sale.fulfillmentType !== "DELIVERY" || sale.shippingMethod !== "SELF") return null;
    if (previousStatus === "DELIVERED") return null; // A rollback is never a new outgoing delivery event.
    if (sale.shippingStatus !== "OUT_FOR_DELIVERY" && sale.shippingStatus !== "DELIVERED") return null;
    const eventStatus: DeliveryLineEvent = sale.shippingStatus;
    const settings = await tx.siteContent.findMany({
      where: { key: { in: [LINE_DELIVERY_NOTIFICATIONS_KEY, "shop_name"] } }, select: { key: true, value: true },
    });
    const enabled = parseLineDeliveryNotificationsEnabled(settings.find(row => row.key === LINE_DELIVERY_NOTIFICATIONS_KEY)?.value);
    const skipReason = getDeliveryNotificationSkipReason({ enabled, sale, eventStatus });
    const id = randomUUID();
    const data = buildDispatchData(sale, settings, eventStatus, eventAt, skipReason, id);
    const created = await tx.saleLineDeliveryDispatch.createMany({ data: [data], skipDuplicates: true });
    return created.count > 0 && data.state === "PENDING" ? id : null;
  } catch (error) {
    // Roll back together with the status rather than leave a committed status without its event.
    throw error;
  }
};

const buildDispatchData = (
  sale: Prisma.SaleGetPayload<{ select: typeof notificationSaleSelect }>,
  settings: Array<{ key: string; value: string }>, eventStatus: DeliveryLineEvent,
  eventAt: Date, skipReason: string | null, id: string,
): Prisma.SaleLineDeliveryDispatchCreateManyInput => {
  const data: Prisma.SaleLineDeliveryDispatchCreateManyInput = {
    id, saleId: sale.id, eventStatus, customerId: sale.customerId,
    recipientLineUserId: sale.customer?.lineUserId ?? null, retryKey: randomUUID(),
    eventAt, payload: {}, state: skipReason ? "SKIPPED" : "PENDING",
    lastErrorCode: skipReason, nextAttemptAt: skipReason ? null : eventAt,
  };
  if (skipReason) return data;
  try {
    const baseUrl = getContentConfig().appBaseUrl;
    if (!baseUrl) throw new Error("MISSING_APP_URL");
    data.payload = buildDeliveryLineCard({
      eventStatus, saleNo: sale.saleNo, customerName: sale.customer?.name ?? "ลูกค้า",
      shopName: settings.find(row => row.key === "shop_name")?.value.trim() || defaultSiteConfig.shopName,
      eventAt, orderUrl: buildDeliveryOrderUrl(baseUrl, sale.id),
    });
  } catch {
    data.state = "FAILED";
    data.lastErrorCode = "INVALID_APP_URL";
    data.nextAttemptAt = null;
  }
  return data;
};
