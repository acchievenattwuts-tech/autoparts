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

// คำถามข้อมูลร้านที่ตอบได้จาก SiteConfig ทุกสำนวน ต้องเข้า SHOP_INFO ไม่ใช่ไหลไป
// general_faq ให้ Knowledge RAG แต่งคำตอบจากบทความ (เสี่ยงได้เวลาทำการ/ช่องทางเก่า)
test("routes every shop-info phrasing (hours / location / contact) to SHOP_INFO", () => {
  for (const text of [
    // เวลาทำการ
    "ร้านเปิดเสาร์อาทิตย์หรือเปล่า",
    "วันนี้เปิดรึเปล่าคะ",
    "พรุ่งนี้เปิดไหม",
    "ปิดรึยังครับ",
    "ร้านหยุดวันไหน",
    "หยุดนักขัตฤกษ์ไหม",
    "เปิดถึงกี่โมง",
    "เวลาปิดร้าน",
    "business hours",
    // ที่ตั้ง / เส้นทาง
    "ร้านอยู่แถวไหน",
    "ขอปักหมุดหน่อยครับ",
    "ขอแผนที่ร้าน",
    "ไปร้านยังไง",
    "มีหน้าร้านไหม",
    // ช่องทางติดต่อ
    "ติดต่อร้าน",
    "ติดต่อได้ที่ไหน",
    "ติดต่อทางไหน",
    "ช่องทางติดต่อ",
    "มีเบอร์ไหม",
    "โทรได้ที่เบอร์ไหน",
    "ขอไลน์ไอดี",
    "contact us",
  ]) {
    const result = routeChatIntent({ messageType: LineMessageType.TEXT, text });

    assert.equal(result.intent, LineIntent.SHOP_INFO, `expected shop info for "${text}"`);
    assert.equal(result.allowsSearch, false);
    assert.equal(result.requiresAdmin, false, `must not freeze for "${text}"`);
    assert.equal(result.reason, "SHOP_INFO_KEYWORD");
  }
});

// กันการขยาย SHOP_INFO_RE กว้างเกินจนกลืน intent ที่ต้องเด้งแอดมิน/ค้นสินค้า
test("the widened shop-info regex does not swallow admin or product turns", () => {
  const cases: Array<[string, LineIntent]> = [
    ["คอมเพรสเซอร์ vios ราคาเท่าไหร่", LineIntent.PURCHASE_INTENT],
    ["โอนแล้วนะครับ ส่งสลิปให้", LineIntent.PAYMENT_SLIP_IMAGE],
    ["ของเสียขอเคลม", LineIntent.CLAIM_OR_RETURN],
    ["เช็คสถานะพัสดุหน่อย", LineIntent.ORDER_STATUS],
    ["หม้อน้ำ d-max ปี 2015", LineIntent.PRODUCT_INQUIRY_TEXT],
    ["ตู้แอร์ vios", LineIntent.PRODUCT_INQUIRY_TEXT],
  ];
  for (const [text, expected] of cases) {
    const result = routeChatIntent({ messageType: LineMessageType.TEXT, text });
    assert.equal(result.intent, expected, `wrong intent for "${text}"`);
  }
});

// ถามที่ตั้งร้านต้องตอบเองจาก SiteConfig แม้ข้อความจะมีคำว่า "ที่อยู่/จังหวัด/ตำบล"
// ที่ SHIPPING_ADDRESS_RE จับไว้และรันก่อน
test("routes shop-address questions to SHOP_INFO instead of the shipping hand-off", () => {
  for (const text of [
    "ขอที่อยู่ร้านหน่อย",
    "ร้านอยู่จังหวัดอะไร",
    "ร้านอยู่ตำบลไหน",
    "ที่อยู่ร้านคืออะไรครับ",
    "บอกที่อยู่ร้านหน่อยได้ไหม",
  ]) {
    const result = routeChatIntent({ messageType: LineMessageType.TEXT, text });

    assert.equal(result.intent, LineIntent.SHOP_INFO, `expected shop info for "${text}"`);
    assert.equal(result.requiresAdmin, false, `must not freeze for "${text}"`);
    assert.equal(result.reason, "SHOP_INFO_KEYWORD");
  }
});

// กฎ ".rules": เรื่องจัดส่งทุกกรณีต้องเด้งแอดมิน — การแยกคำถามที่ตั้งร้านออกมา
// ต้องไม่เจาะกฎนี้ แม้ข้อความจะมีคำว่า "ร้าน" ปนอยู่
test("shop-address carve-out never swallows a real shipping or tax-document turn", () => {
  for (const text of [
    "ส่งของมาที่ร้านได้ไหม",
    "ที่อยู่จัดส่งคือ 55/2 ต.บางม่วง อ.เมือง จ.นครสวรรค์",
    "ขอที่อยู่ร้านสำหรับออกใบกำกับภาษี",
    "ส่งไปที่ร้านผมที่จังหวัดไหนก็ได้ไหม",
    "ร้านผมอยู่ต่างจังหวัด ค่าส่งเท่าไหร่",
    "ที่อยู่ผมคือ 55/2 ร้านนายดำ ตำบลบางม่วง อำเภอเมือง จังหวัดนครสวรรค์",
  ]) {
    const result = routeChatIntent({ messageType: LineMessageType.TEXT, text });

    assert.notEqual(result.intent, LineIntent.SHOP_INFO, `must not be shop info: "${text}"`);
    assert.equal(result.requiresAdmin, true, `must hand off to admin: "${text}"`);
  }
});

// ลูกค้าพิมพ์ที่อยู่แบบย่อ (ต./อ./จ./ถ. + รหัสไปรษณีย์) ต้องเข้ามือแอดมิน ไม่ใช่
// ถูกเอาไปเป็นคำค้นสินค้า
test("routes an abbreviated Thai postal address to the admin shipping hand-off", () => {
  for (const text of [
    "55/2 ร้านนายดำ ต.บางม่วง อ.เมือง จ.นครสวรรค์ 60000",
    "ต.หนองปลิง อ.เมือง จ.นครสวรรค์",
    "123 ม.4 ต.ท่าน้ำอ้อย 60150",
    "บ้านเลขที่ 9 ถ.สวรรค์วิถี ซ.5 60000",
    "แขวงลาดยาว เขตจตุจักร 10900",
  ]) {
    const result = routeChatIntent({ messageType: LineMessageType.TEXT, text });

    assert.equal(
      result.intent,
      LineIntent.SHIPPING_ADDRESS,
      `expected shipping hand-off for "${text}"`,
    );
    assert.equal(result.requiresAdmin, true);
    assert.equal(result.allowsSearch, false);
  }
});

// สัญญาณที่อยู่ต้องไม่ไปกลืนคำค้นสินค้าจริง โดยเฉพาะรหัสอะไหล่ที่มีตัวเลข 5 หลัก
test("the postal-address detector never swallows a product query or part code", () => {
  for (const text of [
    "หม้อน้ำ d-max ปี 2015",
    "คอมเพรสเซอร์ vios 2020",
    "88410-0K080",
    "ตู้แอร์ triton 2019 มีไหม",
    "แผงร้อน ford ranger 60000 บาทไหม",
    "ม.1 คืออะไร",
  ]) {
    const result = routeChatIntent({ messageType: LineMessageType.TEXT, text });

    assert.notEqual(
      result.intent,
      LineIntent.SHIPPING_ADDRESS,
      `must not be read as an address: "${text}"`,
    );
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
