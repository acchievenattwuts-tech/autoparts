import test from "node:test";
import assert from "node:assert/strict";

import { LineIntent, LineMessageType } from "@/lib/generated/prisma";
import { routeLineIntent } from "@/lib/line-intent-router";

test("routes product inquiry text to searchable intent", () => {
  const result = routeLineIntent({
    messageType: LineMessageType.TEXT,
    text: "มีคอมแอร์ vios 2012 ไหม",
  });

  assert.equal(result.intent, LineIntent.PRODUCT_INQUIRY_TEXT);
  assert.equal(result.allowsSearch, true);
  assert.equal(result.requiresAdmin, false);
});

test("routes payment wording away from product search", () => {
  const result = routeLineIntent({
    messageType: LineMessageType.TEXT,
    text: "โอนแล้วครับ ส่งสลิปให้แล้ว",
  });

  assert.equal(result.intent, LineIntent.PAYMENT_SLIP_IMAGE);
  assert.equal(result.allowsSearch, false);
  assert.equal(result.requiresAdmin, true);
});

test("routes shipping address away from product search", () => {
  const result = routeLineIntent({
    messageType: LineMessageType.TEXT,
    text: "ที่อยู่จัดส่ง 99/1 อำเภอเมือง จังหวัดนครสวรรค์",
  });

  assert.equal(result.intent, LineIntent.SHIPPING_ADDRESS);
  assert.equal(result.allowsSearch, false);
});

test("routes claim and return to admin", () => {
  const result = routeLineIntent({
    messageType: LineMessageType.TEXT,
    text: "สินค้าพัง ขอเคลมได้ไหม",
  });

  assert.equal(result.intent, LineIntent.CLAIM_OR_RETURN);
  assert.equal(result.requiresAdmin, true);
});

test("routes greeting without requiring search", () => {
  const result = routeLineIntent({
    messageType: LineMessageType.TEXT,
    text: "สวัสดีครับ",
  });

  assert.equal(result.intent, LineIntent.GREETING);
  assert.equal(result.allowsSearch, false);
  assert.equal(result.requiresAdmin, false);
});

test("routes image to image analysis before search", () => {
  const result = routeLineIntent({
    messageType: LineMessageType.IMAGE,
  });

  assert.equal(result.intent, LineIntent.PART_IMAGE_INQUIRY);
  assert.equal(result.allowsSearch, false);
  assert.equal(result.requiresImageAnalysis, true);
});

test("routes unknown text to admin without search", () => {
  const result = routeLineIntent({
    messageType: LineMessageType.TEXT,
    text: "asdf qwer",
  });

  assert.equal(result.intent, LineIntent.UNKNOWN);
  assert.equal(result.allowsSearch, false);
  assert.equal(result.requiresAdmin, true);
  assert.equal(result.requiresMoreInfo, true);
});
