import assert from "node:assert/strict";
import test from "node:test";
import { buildDeliveryLineCard, buildDeliveryOrderUrl } from "@/lib/line-delivery-card";
import {
  DELIVERED_OUTCOME_UNKNOWN_SKIP_REASON, DELIVERY_CARD_MAX_SALE_AGE_DAYS, getDeliveryNotificationSkipReason,
  isDeliveryDispatchOutcomeUnknown, SALE_TOO_OLD_SKIP_REASON, type DeliveryNotificationSale,
} from "@/lib/line-delivery-policy";
import { parseLineDeliveryNotificationsEnabled } from "@/lib/line-delivery-settings";
import { getLineDeliveryReasonLabel } from "@/lib/line-delivery-status";

// 14:20 on 2026-09-29 in Thailand; the bill was sold earlier the same Thailand day.
const EVENT_AT = new Date("2026-09-29T07:20:00Z");
const sale: DeliveryNotificationSale = {
  status: "ACTIVE", channel: "STORE", fulfillmentType: "DELIVERY", shippingMethod: "SELF", shippingStatus: "OUT_FOR_DELIVERY",
  customerId: "c1", saleDate: new Date("2026-09-28T17:00:00Z"), customer: { id: "c1", isActive: true, lineUserId: "line1", lineLinkedAt: new Date(), phone: "0812345678" },
};

test("delivery notification is strictly opt-in", () => {
  for (const value of [undefined, null, "", "false", "1", "TRUE"]) assert.equal(parseLineDeliveryNotificationsEnabled(value), false);
  assert.equal(parseLineDeliveryNotificationsEnabled("true"), true);
});

test("only selected active phone-linked LINE customer with SELF delivery qualifies", () => {
  const check = (candidate: DeliveryNotificationSale, enabled = true) => getDeliveryNotificationSkipReason({ enabled, sale: candidate, eventStatus: "OUT_FOR_DELIVERY", eventAt: EVENT_AT });
  assert.equal(check(sale), null);
  assert.equal(check(sale, false), "SETTING_DISABLED");
  assert.equal(check({ ...sale, status: "CANCELLED" }), "SALE_INACTIVE");
  assert.equal(check({ ...sale, fulfillmentType: "PICKUP" }), "NOT_SELF_DELIVERY");
  for (const shippingMethod of ["NONE", "FLASH", "OTHER"]) assert.equal(check({ ...sale, shippingMethod }), "NOT_SELF_DELIVERY");
  assert.equal(check({ ...sale, customerId: null }), "CUSTOMER_NOT_LINKED");
  assert.equal(check({ ...sale, customer: null }), "CUSTOMER_NOT_LINKED");
  for (const customer of [
    { ...sale.customer!, lineUserId: null }, { ...sale.customer!, lineLinkedAt: null },
    { ...sale.customer!, phone: null }, { ...sale.customer!, isActive: false },
  ]) assert.equal(check({ ...sale, customer }), "CUSTOMER_NOT_LINKED");
});

test("marketplace sales never qualify, whatever their delivery setup", () => {
  for (const channel of ["SHOPEE", "LAZADA", "SOME_FUTURE_CHANNEL"]) {
    for (const eventStatus of ["OUT_FOR_DELIVERY", "DELIVERED"] as const) {
      const candidate = { ...sale, channel, shippingStatus: eventStatus };
      assert.equal(getDeliveryNotificationSkipReason({ enabled: true, sale: candidate, eventStatus, eventAt: EVENT_AT }), "MARKETPLACE_CHANNEL");
      assert.equal(getDeliveryNotificationSkipReason({
        enabled: true, sale: candidate, eventStatus, eventAt: EVENT_AT, customerId: "c1", recipientLineUserId: "line1",
      }), "MARKETPLACE_CHANNEL");
    }
  }
});

test("out-for-delivery is skipped once the bill's delivered card was sent or may still be sent", () => {
  const check = (deliveredDispatchState: string | null, eventStatus: "OUT_FOR_DELIVERY" | "DELIVERED" = "OUT_FOR_DELIVERY") =>
    getDeliveryNotificationSkipReason({ enabled: true, sale: { ...sale, shippingStatus: eventStatus }, eventStatus, eventAt: EVENT_AT, deliveredDispatchState });
  for (const state of ["ACCEPTED", "PENDING", "PROCESSING"]) assert.equal(check(state), "ALREADY_DELIVERED");
  // A completion card that was never sent does not hold back a later out-for-delivery card.
  for (const state of [null, "SKIPPED", "FAILED"]) assert.equal(check(state), null);
  assert.equal(check("ACCEPTED", "DELIVERED"), null);
});

// Owner decision P7a: a delivered card that failed with an unknown result may have reached the customer.
test("out-for-delivery is skipped when the delivered card failed with an unknown result, not after a definite rejection", () => {
  const check = (state: string | null, code: string | null, eventStatus: "OUT_FOR_DELIVERY" | "DELIVERED" = "OUT_FOR_DELIVERY") =>
    getDeliveryNotificationSkipReason({
      enabled: true, sale: { ...sale, shippingStatus: eventStatus }, eventStatus, eventAt: EVENT_AT,
      deliveredDispatchState: state, deliveredDispatchErrorCode: code,
    });
  // Network error / timeout, a worker that died mid-send, LINE 5xx: the request may have reached LINE.
  for (const code of ["LINE_NETWORK_ERROR", "LEASE_EXPIRED", "LINE_HTTP_500", "LINE_HTTP_502", "LINE_HTTP_503", "LINE_HTTP_504"]) {
    assert.equal(check("FAILED", code), DELIVERED_OUTCOME_UNKNOWN_SKIP_REASON, code);
    assert.equal(isDeliveryDispatchOutcomeUnknown("FAILED", code), true, code);
  }
  // A definite rejection or a card that was never sent does not hold back the out-for-delivery card.
  for (const code of [
    "LINE_HTTP_400", "LINE_HTTP_401", "LINE_HTTP_403", "LINE_HTTP_409", "LINE_HTTP_429", "LINE_CONFIG_MISSING",
    "INVALID_PAYLOAD", "INVALID_APP_URL", "DISPATCH_PROCESSING_ERROR", null,
  ]) assert.equal(check("FAILED", code), null, String(code));
  // Only a FAILED row counts; a skipped row with such a code was never attempted.
  assert.equal(check("SKIPPED", "LINE_NETWORK_ERROR"), null);
  assert.equal(isDeliveryDispatchOutcomeUnknown("SKIPPED", "LINE_NETWORK_ERROR"), false);
  // The rule only holds back out-for-delivery cards, and a sent card keeps its own reason.
  assert.equal(check("FAILED", "LINE_NETWORK_ERROR", "DELIVERED"), null);
  assert.equal(check("ACCEPTED", null), "ALREADY_DELIVERED");
  assert.equal(getLineDeliveryReasonLabel(DELIVERED_OUTCOME_UNKNOWN_SKIP_REASON), "แจ้งส่งสำเร็จอาจถึงลูกค้าแล้ว (ไม่ทราบผลการส่ง)");
});

// Owner decision S4: an old delivered row closed by the retired retry policy may have reached the customer.
test("a delivered card that ended FAILED with the legacy RETRY_WINDOW_EXPIRED blocks out-for-delivery as outcome unknown", () => {
  const check = (state: string | null, code: string | null, eventStatus: "OUT_FOR_DELIVERY" | "DELIVERED" = "OUT_FOR_DELIVERY") =>
    getDeliveryNotificationSkipReason({
      enabled: true, sale: { ...sale, shippingStatus: eventStatus }, eventStatus, eventAt: EVENT_AT,
      deliveredDispatchState: state, deliveredDispatchErrorCode: code,
    });
  assert.equal(isDeliveryDispatchOutcomeUnknown("FAILED", "RETRY_WINDOW_EXPIRED"), true);
  assert.equal(check("FAILED", "RETRY_WINDOW_EXPIRED"), DELIVERED_OUTCOME_UNKNOWN_SKIP_REASON);
  // Only a FAILED row counts, and only out-for-delivery cards are held back.
  assert.equal(isDeliveryDispatchOutcomeUnknown("SKIPPED", "RETRY_WINDOW_EXPIRED"), false);
  assert.equal(check("SKIPPED", "RETRY_WINDOW_EXPIRED"), null);
  assert.equal(check("FAILED", "RETRY_WINDOW_EXPIRED", "DELIVERED"), null);
});

test("worker rejects changed recipients and stale forward or backward status", () => {
  assert.equal(getDeliveryNotificationSkipReason({ enabled: true, sale, eventStatus: "OUT_FOR_DELIVERY", eventAt: EVENT_AT, customerId: "other", recipientLineUserId: "line1" }), "RECIPIENT_CHANGED");
  assert.equal(getDeliveryNotificationSkipReason({ enabled: true, sale, eventStatus: "OUT_FOR_DELIVERY", eventAt: EVENT_AT, customerId: "c1", recipientLineUserId: "newLine" }), "RECIPIENT_CHANGED");
  for (const shippingStatus of ["PENDING", "DELIVERED"]) {
    assert.equal(getDeliveryNotificationSkipReason({ enabled: true, sale: { ...sale, shippingStatus }, eventStatus: "OUT_FOR_DELIVERY", eventAt: EVENT_AT }), "STALE_STATUS");
  }
});

test("bills sold more than 30 Thailand days before the event are never sent, at enqueue or before sending", () => {
  const check = (saleDate: Date, extra: { customerId?: string; recipientLineUserId?: string } = {}) =>
    getDeliveryNotificationSkipReason({ enabled: true, sale: { ...sale, saleDate }, eventStatus: "OUT_FOR_DELIVERY", eventAt: EVENT_AT, ...extra });
  assert.equal(DELIVERY_CARD_MAX_SALE_AGE_DAYS, 30);
  // 2026-08-30 00:00 Thailand is exactly 30 Thailand days before 2026-09-29: still sent.
  assert.equal(check(new Date("2026-08-29T17:00:00Z")), null);
  // 23:59 on 2026-08-29 Thailand is 31 days: skipped, even though under 31 x 24h have passed.
  assert.equal(check(new Date("2026-08-29T16:59:00Z")), SALE_TOO_OLD_SKIP_REASON);
  assert.equal(check(new Date("2026-08-29T16:59:00Z"), { customerId: "c1", recipientLineUserId: "line1" }), SALE_TOO_OLD_SKIP_REASON);
  // A marketplace bill keeps its own reason.
  assert.equal(getDeliveryNotificationSkipReason({
    enabled: true, sale: { ...sale, channel: "SHOPEE", saleDate: new Date("2026-01-01T00:00:00Z") }, eventStatus: "OUT_FOR_DELIVERY", eventAt: EVENT_AT,
  }), "MARKETPLACE_CHANNEL");
});

test("both cards open exact customer order with approved copy and Gregorian Thailand event time", () => {
  const orderUrl = buildDeliveryOrderUrl("https://shop.test/old-path?x=1", "sale-1");
  assert.equal(orderUrl, "https://shop.test/liff/orders/sale-1");
  for (const eventStatus of ["OUT_FOR_DELIVERY", "DELIVERED"] as const) {
    const card = buildDeliveryLineCard({ eventStatus, shopName: "ศรีวรรณ อะไหล่แอร์", saleNo: "SL202609290001", customerName: "อู่ตัวอย่าง", eventAt: new Date("2026-09-29T07:20:00Z"), orderUrl });
    const rendered = JSON.stringify(card);
    assert.ok(rendered.includes(orderUrl));
    assert.ok(rendered.includes("ศรีวรรณ อะไหล่แอร์"));
    assert.ok(rendered.includes("2026"));
    assert.ok(rendered.includes("14:20"));
    assert.ok(!rendered.includes("2569"));
    assert.ok(rendered.includes(eventStatus === "DELIVERED" ? "ดูรายการสั่งซื้อ" : "ทางร้านกำลังนำสินค้าไปจัดส่งให้คุณ"));
    assert.ok(!rendered.includes("tracking/"));
    assert.ok(!rendered.includes("totalAmount"));
    assert.ok(rendered.includes(eventStatus === "DELIVERED" ? "#0F766E" : "#125E9E"));
  }
});

test("customer links cannot use HTTP or credential-bearing URLs", () => {
  for (const url of ["http://shop.test", "javascript:alert(1)", "https://secret@shop.test"]) {
    assert.throws(() => buildDeliveryOrderUrl(url, "sale1"));
  }
  assert.equal(buildDeliveryOrderUrl("https://shop.test", "sale/a?b"), "https://shop.test/liff/orders/sale%2Fa%3Fb");
  // A LIFF ID never bypasses the app URL check.
  for (const url of ["http://shop.test", "https://secret@shop.test"]) {
    assert.throws(() => buildDeliveryOrderUrl(url, "sale1", "1234567890-AbCdEfGh"));
  }
});

test("with a LIFF ID the card opens the order through the LIFF launch URL", () => {
  assert.equal(
    buildDeliveryOrderUrl("https://shop.test/old-path?x=1", "sale-1", "1234567890-AbCdEfGh"),
    "https://liff.line.me/1234567890-AbCdEfGh/orders/sale-1",
  );
  assert.equal(
    buildDeliveryOrderUrl("https://shop.test", "sale/a?b", " 1234567890-AbCdEfGh "),
    "https://liff.line.me/1234567890-AbCdEfGh/orders/sale%2Fa%3Fb",
  );
  // Missing or blank LIFF ID falls back to the plain web URL.
  for (const liffId of [undefined, null, "", "   "]) {
    assert.equal(buildDeliveryOrderUrl("https://shop.test", "sale-1", liffId), "https://shop.test/liff/orders/sale-1");
  }
});
