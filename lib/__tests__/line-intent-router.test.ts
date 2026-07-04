import test from "node:test";
import assert from "node:assert/strict";

import { LineIntent, LineMessageType } from "@/lib/generated/prisma";
import { routeLineIntent } from "@/lib/chat-core/intent-router";

test("routes product inquiry text to searchable intent", () => {
  const result = routeLineIntent({
    messageType: LineMessageType.TEXT,
    text: "มีคอมแอร์ vios 2012 ไหม",
  });

  assert.equal(result.intent, LineIntent.PRODUCT_INQUIRY_TEXT);
  assert.equal(result.allowsSearch, true);
  assert.equal(result.requiresAdmin, false);
});

test("routes a short part code/number to searchable product inquiry", () => {
  for (const text of ["508 o", "508", "tv12", "6pk1234", "134a"]) {
    const result = routeLineIntent({
      messageType: LineMessageType.TEXT,
      text,
    });

    assert.equal(result.intent, LineIntent.PRODUCT_INQUIRY_TEXT, `expected product inquiry for "${text}"`);
    assert.equal(result.allowsSearch, true, `expected search enabled for "${text}"`);
    assert.equal(result.requiresAdmin, false);
  }
});

test("routes purchase wording to admin without search", () => {
  for (const text of ["เอาตัวนี้เลยค่ะ", "สั่งซื้อ 2 อัน", "กี่บาทคะ", "ซื้อเลยค่ะ", "รับของยังไง"]) {
    const result = routeLineIntent({ messageType: LineMessageType.TEXT, text });
    assert.equal(result.intent, LineIntent.PURCHASE_INTENT, `expected purchase intent for "${text}"`);
    assert.equal(result.allowsSearch, false);
    assert.equal(result.requiresAdmin, true);
  }
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

test("routes shipping-service questions to the AI shop-info reply (no admin)", () => {
  for (const text of [
    "มีบริการจัดส่งไหม",
    "ส่งต่างจังหวัดได้ไหม",
    "ส่งทั่วประเทศไหม",
    "ค่าจัดส่งคิดยังไง",
    "ค่าส่งคิดอย่างไร",
    "ส่งกี่วัน",
  ]) {
    const result = routeLineIntent({ messageType: LineMessageType.TEXT, text });

    assert.equal(result.intent, LineIntent.SHOP_INFO, `expected shop info for "${text}"`);
    assert.equal(result.allowsSearch, false);
    assert.equal(result.requiresAdmin, false, `expected no admin handoff for "${text}"`);
    assert.equal(result.reason, "SHIPPING_SERVICE_INQUIRY");
  }
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

test("routes shop-info keywords to the AI shop-info reply (no admin)", () => {
  for (const text of ["เวลาทำการ", "ติดต่อร้าน", "ร้านเปิดกี่โมง", "เบอร์โทรร้าน"]) {
    const result = routeLineIntent({ messageType: LineMessageType.TEXT, text });

    assert.equal(result.intent, LineIntent.SHOP_INFO, `expected shop info for "${text}"`);
    assert.equal(result.allowsSearch, false);
    assert.equal(result.requiresAdmin, false);
    assert.equal(result.reason, "SHOP_INFO_KEYWORD");
  }
});

test("routes ติดต่อสอบถาม to the shop-info reply", () => {
  const result = routeLineIntent({ messageType: LineMessageType.TEXT, text: "ติดต่อสอบถาม" });
  assert.equal(result.intent, LineIntent.SHOP_INFO);
  assert.equal(result.requiresAdmin, false);
  assert.equal(result.reason, "SHOP_INFO_KEYWORD");
});

test("routes part-finding phrases to product inquiry (searchable)", () => {
  for (const text of ["หาอะไหล่", "สอบถามอะไหล่"]) {
    const result = routeLineIntent({ messageType: LineMessageType.TEXT, text });

    assert.equal(result.intent, LineIntent.PRODUCT_INQUIRY_TEXT, `expected product inquiry for "${text}"`);
    assert.equal(result.allowsSearch, true);
    assert.equal(result.requiresAdmin, false);
  }
});

test("routes image to image analysis before search", () => {
  const result = routeLineIntent({
    messageType: LineMessageType.IMAGE,
  });

  assert.equal(result.intent, LineIntent.PART_IMAGE_INQUIRY);
  assert.equal(result.allowsSearch, false);
  assert.equal(result.requiresImageAnalysis, true);
});

test("defaults freeform text (Thai part name / car model) to a product search", () => {
  for (const text of ["คอยเย็น ดีแม็ก", "พัดลมหม้อน้ำ triton", "asdf qwer"]) {
    const result = routeLineIntent({
      messageType: LineMessageType.TEXT,
      text,
    });

    assert.equal(result.intent, LineIntent.PRODUCT_INQUIRY_TEXT, `expected product inquiry for "${text}"`);
    assert.equal(result.allowsSearch, true, `expected search enabled for "${text}"`);
    assert.equal(result.requiresAdmin, false);
  }
});

test("still routes the special intents (payment/claim/etc.) away from product search", () => {
  // Sanity: the default-to-search fallback must not swallow admin-only intents.
  assert.equal(
    routeLineIntent({ messageType: LineMessageType.TEXT, text: "โอนเงินแล้วค่ะ" }).intent,
    LineIntent.PAYMENT_SLIP_IMAGE,
  );
  assert.equal(
    routeLineIntent({ messageType: LineMessageType.TEXT, text: "ขอเคลมสินค้า" }).intent,
    LineIntent.CLAIM_OR_RETURN,
  );
});
