import assert from "node:assert/strict";
import test from "node:test";
import { buildDeliveryLineCard, buildDeliveryOrderUrl } from "@/lib/line-delivery-card";
import { getDeliveryNotificationSkipReason, type DeliveryNotificationSale } from "@/lib/line-delivery-policy";
import { parseLineDeliveryNotificationsEnabled } from "@/lib/line-delivery-settings";

const sale: DeliveryNotificationSale = {
  status: "ACTIVE", fulfillmentType: "DELIVERY", shippingMethod: "SELF", shippingStatus: "OUT_FOR_DELIVERY",
  customerId: "c1", customer: { id: "c1", isActive: true, lineUserId: "line1", lineLinkedAt: new Date(), phone: "0812345678" },
};

test("delivery notification is strictly opt-in", () => {
  for (const value of [undefined, null, "", "false", "1", "TRUE"]) assert.equal(parseLineDeliveryNotificationsEnabled(value), false);
  assert.equal(parseLineDeliveryNotificationsEnabled("true"), true);
});

test("only selected active phone-linked LINE customer with SELF delivery qualifies", () => {
  const check = (candidate: DeliveryNotificationSale, enabled = true) => getDeliveryNotificationSkipReason({ enabled, sale: candidate, eventStatus: "OUT_FOR_DELIVERY" });
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

test("worker rejects changed recipients and stale forward or backward status", () => {
  assert.equal(getDeliveryNotificationSkipReason({ enabled: true, sale, eventStatus: "OUT_FOR_DELIVERY", customerId: "other", recipientLineUserId: "line1" }), "RECIPIENT_CHANGED");
  assert.equal(getDeliveryNotificationSkipReason({ enabled: true, sale, eventStatus: "OUT_FOR_DELIVERY", customerId: "c1", recipientLineUserId: "newLine" }), "RECIPIENT_CHANGED");
  for (const shippingStatus of ["PENDING", "DELIVERED"]) {
    assert.equal(getDeliveryNotificationSkipReason({ enabled: true, sale: { ...sale, shippingStatus }, eventStatus: "OUT_FOR_DELIVERY" }), "STALE_STATUS");
  }
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
});
