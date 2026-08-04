import test from "node:test";
import assert from "node:assert/strict";

import { LineIntent, LineMessageType } from "@/lib/generated/prisma";
import { routeChatIntent } from "@/lib/chat-core/intent-router";

test("routes product inquiry text to searchable intent", () => {
  const result = routeChatIntent({
    messageType: LineMessageType.TEXT,
    text: "มีคอมแอร์ vios 2012 ไหม",
  });

  assert.equal(result.intent, LineIntent.PRODUCT_INQUIRY_TEXT);
  assert.equal(result.allowsSearch, true);
  assert.equal(result.requiresAdmin, false);
});

test("routes a short part code/number to searchable product inquiry", () => {
  for (const text of ["508 o", "508", "tv12", "6pk1234", "134a"]) {
    const result = routeChatIntent({
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
    const result = routeChatIntent({ messageType: LineMessageType.TEXT, text });
    assert.equal(result.intent, LineIntent.PURCHASE_INTENT, `expected purchase intent for "${text}"`);
    assert.equal(result.allowsSearch, false);
    assert.equal(result.requiresAdmin, true);
  }
});

test("routes payment wording away from product search", () => {
  const result = routeChatIntent({
    messageType: LineMessageType.TEXT,
    text: "โอนแล้วครับ ส่งสลิปให้แล้ว",
  });

  assert.equal(result.intent, LineIntent.PAYMENT_SLIP_IMAGE);
  assert.equal(result.allowsSearch, false);
  assert.equal(result.requiresAdmin, true);
});

test("routes shipping address away from product search", () => {
  const result = routeChatIntent({
    messageType: LineMessageType.TEXT,
    text: "ที่อยู่จัดส่ง 99/1 อำเภอเมือง จังหวัดนครสวรรค์",
  });

  assert.equal(result.intent, LineIntent.SHIPPING_ADDRESS);
  assert.equal(result.allowsSearch, false);
});

test("routes every shipping-service question to admin", () => {
  for (const text of [
    "มีบริการจัดส่งไหม",
    "ส่งต่างจังหวัดได้ไหม",
    "ส่งทั่วประเทศไหม",
    "ค่าจัดส่งคิดยังไง",
    "ค่าส่งคิดอย่างไร",
    "ส่งกี่วัน",
  ]) {
    const result = routeChatIntent({ messageType: LineMessageType.TEXT, text });

    assert.equal(result.intent, LineIntent.SHIPPING_ADDRESS, `expected shipping handoff for "${text}"`);
    assert.equal(result.allowsSearch, false);
    assert.equal(result.requiresAdmin, true, `expected admin handoff for "${text}"`);
    assert.equal(result.reason, "SHIPPING_ADMIN_ONLY");
  }
});

test("routes quotation requests to admin without product search", () => {
  for (const text of [
    "ทำใบเสนอราคามาให้หน่อยได้ไหมคะ ต้องการ 15 อัน",
    "ขอใบเสนอราคา P0444 จำนวน 15 ตัว",
    "ออก quotation ให้หน่อยครับ",
    "ขอ quote 10 ชิ้น",
    "รบกวนจัดทำใบ quotation ค่ะ",
  ]) {
    const result = routeChatIntent({ messageType: LineMessageType.TEXT, text });

    assert.equal(result.intent, LineIntent.PURCHASE_INTENT, `expected quotation handoff for "${text}"`);
    assert.equal(result.allowsSearch, false);
    assert.equal(result.requiresAdmin, true);
    assert.equal(result.reason, "QUOTATION_REQUEST_KEYWORD");
  }
});

test("does not confuse other document requests with a quotation", () => {
  for (const text of ["ขอใบเสร็จรับเงินค่ะ", "ขอใบกำกับภาษีเต็มรูปแบบ"]) {
    const result = routeChatIntent({ messageType: LineMessageType.TEXT, text });
    assert.notEqual(result.reason, "QUOTATION_REQUEST_KEYWORD", `unexpected quotation match for "${text}"`);
  }
});

test("routes car aircon service questions to admin without product search", () => {
  for (const text of [
    "\u0e23\u0e31\u0e1a\u0e2d\u0e31\u0e14\u0e2a\u0e32\u0e22\u0e41\u0e2d\u0e23\u0e4c\u0e44\u0e2b\u0e21\u0e04\u0e23\u0e31\u0e1a",
    "\u0e2d\u0e31\u0e14\u0e2a\u0e32\u0e22\u0e41\u0e2d\u0e23\u0e4c\u0e44\u0e14\u0e49\u0e44\u0e2b\u0e21",
    "\u0e40\u0e15\u0e34\u0e21\u0e19\u0e49\u0e33\u0e22\u0e32\u0e41\u0e2d\u0e23\u0e4c\u0e44\u0e2b\u0e21\u0e04\u0e23\u0e31\u0e1a",
    "\u0e25\u0e49\u0e32\u0e07\u0e41\u0e2d\u0e23\u0e4c\u0e23\u0e16\u0e22\u0e19\u0e15\u0e4c\u0e44\u0e14\u0e49\u0e44\u0e2b\u0e21",
  ]) {
    const result = routeChatIntent({ messageType: LineMessageType.TEXT, text });

    assert.equal(result.intent, LineIntent.UNKNOWN, `expected service handoff for "${text}"`);
    assert.equal(result.allowsSearch, false, `expected no search for "${text}"`);
    assert.equal(result.requiresAdmin, true, `expected admin handoff for "${text}"`);
    assert.equal(result.reason, "SERVICE_INQUIRY_KEYWORD");
  }
});

test("routes claim and return to admin", () => {
  const result = routeChatIntent({
    messageType: LineMessageType.TEXT,
    text: "สินค้าพัง ขอเคลมได้ไหม",
  });

  assert.equal(result.intent, LineIntent.CLAIM_OR_RETURN);
  assert.equal(result.requiresAdmin, true);
});

test("routes informational warranty and return-policy questions to admin", () => {
  for (const text of [
    "ประกันกี่วัน",
    "เงื่อนไขรับประกันมีอะไรบ้าง",
    "คืนสินค้าได้ไหม",
    "นโยบายคืนสินค้าภายในกี่วัน",
  ]) {
    const result = routeChatIntent({ messageType: LineMessageType.TEXT, text });
    assert.equal(result.intent, LineIntent.CLAIM_OR_RETURN, `expected claim handoff for "${text}"`);
    assert.equal(result.allowsSearch, false);
    assert.equal(result.requiresAdmin, true);
    assert.equal(result.reason, "WARRANTY_RETURN_ADMIN_ONLY");
  }
});

test("routes greeting without requiring search", () => {
  const result = routeChatIntent({
    messageType: LineMessageType.TEXT,
    text: "สวัสดีครับ",
  });

  assert.equal(result.intent, LineIntent.GREETING);
  assert.equal(result.allowsSearch, false);
  assert.equal(result.requiresAdmin, false);
});

test("routes shop-info keywords to the AI shop-info reply (no admin)", () => {
  for (const text of ["เวลาทำการ", "ติดต่อร้าน", "ร้านเปิดกี่โมง", "เบอร์โทรร้าน"]) {
    const result = routeChatIntent({ messageType: LineMessageType.TEXT, text });

    assert.equal(result.intent, LineIntent.SHOP_INFO, `expected shop info for "${text}"`);
    assert.equal(result.allowsSearch, false);
    assert.equal(result.requiresAdmin, false);
    assert.equal(result.reason, "SHOP_INFO_KEYWORD");
  }
});

test("routes ติดต่อสอบถาม to the shop-info reply", () => {
  const result = routeChatIntent({ messageType: LineMessageType.TEXT, text: "ติดต่อสอบถาม" });
  assert.equal(result.intent, LineIntent.SHOP_INFO);
  assert.equal(result.requiresAdmin, false);
  assert.equal(result.reason, "SHOP_INFO_KEYWORD");
});

// การกด/พิมพ์ "ติดต่อร้าน" และคำถามเรื่องเดียวกัน (เวลาเปิด/เบอร์/แผนที่) ต้องได้คำตอบ
// ข้อมูลร้านอัตโนมัติเสมอ และต้องไม่ freeze ห้องรอแอดมิน (requiresAdmin = false)
test("routes contact-shop near-equivalent phrases to the shop-info reply (never freezes)", () => {
  for (const text of [
    "ติดต่อร้าน",
    "ติดต่อยังไง",
    "ติดต่อทางไหน",
    "ช่องทางติดต่อ",
    "ขอเบอร์หน่อยครับ",
    "ขอแผนที่ร้าน",
    "ร้านเปิดทุกวันไหม",
    "เปิดวันอาทิตย์ไหม",
    "ปิดวันไหน",
    "opening hours",
  ]) {
    const result = routeChatIntent({ messageType: LineMessageType.TEXT, text });

    assert.equal(result.intent, LineIntent.SHOP_INFO, `expected shop info for "${text}"`);
    assert.equal(result.allowsSearch, false);
    assert.equal(result.requiresAdmin, false, `must not freeze for "${text}"`);
    assert.equal(result.reason, "SHOP_INFO_KEYWORD");
  }
});

test("routes part-finding phrases to product inquiry (searchable)", () => {
  for (const text of ["หาอะไหล่", "สอบถามอะไหล่"]) {
    const result = routeChatIntent({ messageType: LineMessageType.TEXT, text });

    assert.equal(result.intent, LineIntent.PRODUCT_INQUIRY_TEXT, `expected product inquiry for "${text}"`);
    assert.equal(result.allowsSearch, true);
    assert.equal(result.requiresAdmin, false);
  }
});

test("routes image to image analysis before search", () => {
  const result = routeChatIntent({
    messageType: LineMessageType.IMAGE,
  });

  assert.equal(result.intent, LineIntent.PART_IMAGE_INQUIRY);
  assert.equal(result.allowsSearch, false);
  assert.equal(result.requiresImageAnalysis, true);
});

test("defaults freeform text (Thai part name / car model) to a product search", () => {
  for (const text of ["คอยเย็น ดีแม็ก", "พัดลมหม้อน้ำ triton", "asdf qwer"]) {
    const result = routeChatIntent({
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
    routeChatIntent({ messageType: LineMessageType.TEXT, text: "โอนเงินแล้วค่ะ" }).intent,
    LineIntent.PAYMENT_SLIP_IMAGE,
  );
  assert.equal(
    routeChatIntent({ messageType: LineMessageType.TEXT, text: "ขอเคลมสินค้า" }).intent,
    LineIntent.CLAIM_OR_RETURN,
  );
});
