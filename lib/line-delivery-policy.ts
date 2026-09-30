import type { DeliveryLineEvent } from "@/lib/line-delivery-card";
import { getThailandDateKey, parseDateOnlyToDate } from "@/lib/th-date";

export type DeliveryNotificationSale = {
  status: string; channel: string; fulfillmentType: string; shippingMethod: string; shippingStatus: string;
  customerId: string | null;
  /** Date-only business field; compared by Thailand calendar day. */
  saleDate: Date;
  customer: { id: string; isActive: boolean; lineUserId: string | null; lineLinkedAt: Date | null; phone: string | null } | null;
};

// Only in-store sales notify customers. Every other channel (Shopee, Lazada, and
// any channel added later) is a marketplace sale whose buyer is served by the
// platform, so it never receives a LINE delivery card.
const STORE_SALE_CHANNEL = "STORE";

// A completion card that was accepted by LINE, or that may still be sent, means
// an "out for delivery" card for the same bill would reach the customer after
// "delivered". SKIPPED completion cards were never sent.
const DELIVERED_DISPATCH_SENT_OR_IN_FLIGHT_STATES: ReadonlySet<string> = new Set(["ACCEPTED", "PENDING", "PROCESSING"]);

// Owner decision P7a: a completion card that ended FAILED with an unknown result
// may still have reached the customer — the request can arrive at LINE before a
// network error or timeout, before the worker died mid-send (LEASE_EXPIRED), or
// before LINE answered 5xx. A definite rejection (HTTP 4xx, missing configuration,
// invalid payload or app URL) never reached the customer and does not block.
// Owner decision S4: RETRY_WINDOW_EXPIRED is a legacy code, written only by the retry policy that
// ended with T6 after up to 24 hours of attempts, any of which may have reached LINE, so an old
// row holding it counts as unknown too.
const DELIVERED_OUTCOME_UNKNOWN_ERROR_CODES: ReadonlySet<string> = new Set([
  "LINE_NETWORK_ERROR",
  "LEASE_EXPIRED",
  "RETRY_WINDOW_EXPIRED",
]);
const LINE_SERVER_ERROR_CODE_PATTERN = /^LINE_HTTP_5\d{2}$/;
export const DELIVERED_OUTCOME_UNKNOWN_SKIP_REASON = "DELIVERED_OUTCOME_UNKNOWN";

/** True for a FAILED dispatch whose request may have reached LINE. */
export const isDeliveryDispatchOutcomeUnknown = (state: string | null | undefined, lastErrorCode: string | null | undefined): boolean =>
  state === "FAILED" && typeof lastErrorCode === "string" &&
  (DELIVERED_OUTCOME_UNKNOWN_ERROR_CODES.has(lastErrorCode) || LINE_SERVER_ERROR_CODE_PATTERN.test(lastErrorCode));

// A card for a bill sold more than this many Thailand calendar days before the
// delivery event is never sent. This also covers old bills whose dispatch rows
// were already removed by the retention cleanup and would otherwise re-enqueue.
export const DELIVERY_CARD_MAX_SALE_AGE_DAYS = 30;
export const SALE_TOO_OLD_SKIP_REASON = "SALE_TOO_OLD";
const DAY_MS = 24 * 60 * 60 * 1000;

const getThailandDaysBetween = (from: Date, to: Date): number =>
  Math.round((parseDateOnlyToDate(getThailandDateKey(to)).getTime() - parseDateOnlyToDate(getThailandDateKey(from)).getTime()) / DAY_MS);

export const getDeliveryNotificationSkipReason = (input: {
  enabled: boolean; sale: DeliveryNotificationSale; eventStatus: DeliveryLineEvent;
  /** When the delivery status changed (the dispatch row's eventAt). */
  eventAt: Date;
  customerId?: string | null; recipientLineUserId?: string | null;
  /** State of the same bill's DELIVERED dispatch row, when one exists. */
  deliveredDispatchState?: string | null;
  /** lastErrorCode of that DELIVERED dispatch row. */
  deliveredDispatchErrorCode?: string | null;
}): string | null => {
  const { sale } = input;
  if (!input.enabled) return "SETTING_DISABLED";
  if (sale.status !== "ACTIVE") return "SALE_INACTIVE";
  if (sale.channel !== STORE_SALE_CHANNEL) return "MARKETPLACE_CHANNEL";
  if (sale.fulfillmentType !== "DELIVERY" || sale.shippingMethod !== "SELF") return "NOT_SELF_DELIVERY";
  if (getThailandDaysBetween(sale.saleDate, input.eventAt) > DELIVERY_CARD_MAX_SALE_AGE_DAYS) return SALE_TOO_OLD_SKIP_REASON;
  if (!sale.customerId || !sale.customer?.isActive || !sale.customer.lineUserId || !sale.customer.lineLinkedAt || !sale.customer.phone) {
    return "CUSTOMER_NOT_LINKED";
  }
  if (input.customerId !== undefined && (sale.customerId !== input.customerId || sale.customer.lineUserId !== input.recipientLineUserId)) {
    return "RECIPIENT_CHANGED";
  }
  if (input.eventStatus === "OUT_FOR_DELIVERY" && input.deliveredDispatchState) {
    if (DELIVERED_DISPATCH_SENT_OR_IN_FLIGHT_STATES.has(input.deliveredDispatchState)) return "ALREADY_DELIVERED";
    if (isDeliveryDispatchOutcomeUnknown(input.deliveredDispatchState, input.deliveredDispatchErrorCode)) {
      return DELIVERED_OUTCOME_UNKNOWN_SKIP_REASON;
    }
  }
  if (sale.shippingStatus !== input.eventStatus) return "STALE_STATUS";
  return null;
};
