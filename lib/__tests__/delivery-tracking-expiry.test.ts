import assert from "node:assert/strict";
import test from "node:test";

import {
  getTrackingContactPhone,
  isTrackingExpired,
  TRACKING_LINK_TTL_MS,
} from "@/lib/delivery-tracking";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-24T05:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);

test("tracking links live 7 days", () => {
  assert.equal(TRACKING_LINK_TTL_MS, 7 * DAY_MS);
});

test("no explicit expiry no longer means valid forever: expires 7 days after the sale's last update", () => {
  const base = { trackingExpiry: null, shippingStatus: "OUT_FOR_DELIVERY" };
  assert.equal(isTrackingExpired({ ...base, updatedAt: daysAgo(1) }, now), false);
  assert.equal(isTrackingExpired({ ...base, updatedAt: daysAgo(6.9) }, now), false);
  assert.equal(isTrackingExpired({ ...base, updatedAt: daysAgo(7.1) }, now), true);
  assert.equal(isTrackingExpired({ ...base, updatedAt: daysAgo(400) }, now), true);
});

test("an explicit expiry (DELIVERED +48h / sale cancelled) still wins over the fallback", () => {
  const future = new Date(now.getTime() + DAY_MS);
  const past = new Date(now.getTime() - 60_000);
  assert.equal(
    isTrackingExpired({ trackingExpiry: future, shippingStatus: "DELIVERED", updatedAt: daysAgo(30) }, now),
    false,
  );
  assert.equal(
    isTrackingExpired({ trackingExpiry: past, shippingStatus: "DELIVERED", updatedAt: daysAgo(0) }, now),
    true,
  );
});

test("a CANCELLED shipment expires immediately, whatever the stored expiry", () => {
  const future = new Date(now.getTime() + DAY_MS);
  assert.equal(
    isTrackingExpired({ trackingExpiry: null, shippingStatus: "CANCELLED", updatedAt: now }, now),
    true,
  );
  assert.equal(
    isTrackingExpired({ trackingExpiry: future, shippingStatus: "CANCELLED", updatedAt: now }, now),
    true,
  );
});

test("the contact phone is the shop phone, hidden when not configured", () => {
  assert.equal(getTrackingContactPhone("02-123-4567"), "02-123-4567");
  assert.equal(getTrackingContactPhone("  081-234-5678 "), "081-234-5678");
  assert.equal(getTrackingContactPhone(""), null);
  assert.equal(getTrackingContactPhone("   "), null);
  assert.equal(getTrackingContactPhone(undefined), null);
});
