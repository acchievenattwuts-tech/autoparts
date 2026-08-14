import test from "node:test";
import assert from "node:assert/strict";

import { LineIntent, LineMessageType } from "@/lib/generated/prisma";
import { detectChatIntentTypo, CHAT_INTENT_TYPO_KEYWORDS } from "@/lib/chat-core/intent-typo-guard";
import { routeChatIntent } from "@/lib/chat-core/intent-router";

const route = (text: string) => routeChatIntent({ messageType: LineMessageType.TEXT, text });

test("catches an internal misspelling of a high-stakes keyword", () => {
  const cases: Array<[string, LineIntent]> = [
    ["เครมของหน่อยครับ", LineIntent.CLAIM_OR_RETURN], // เคลม (ล→ร)
    ["ขอเปลี่ยนสินค้าา", LineIntent.CLAIM_OR_RETURN],
    ["ส่งสลิบให้แล้วนะ", LineIntent.PAYMENT_SLIP_IMAGE], // สลิป (ป→บ)
    ["โอนเงืนไปแล้ว", LineIntent.PAYMENT_SLIP_IMAGE], // โอนเงิน
    ["ขอใบเสนอราค่าหน่อย", LineIntent.PURCHASE_INTENT], // ใบเสนอราคา
    ["รหัสไปรษณีย หน่อย", LineIntent.SHIPPING_ADDRESS],
    ["ขอเบอโทรร้าน", LineIntent.SHOP_INFO], // เบอร์โทร
    ["ค่าสงเท่าไหร", LineIntent.SHIPPING_ADDRESS],
    ["สงตจวมั้ย", LineIntent.SHIPPING_ADDRESS],
    ["จัดสงได้ไหม", LineIntent.SHIPPING_ADDRESS],
    ["รหัสไปรสนี 60000", LineIntent.SHIPPING_ADDRESS],
    ["เลขบันชีอะไร", LineIntent.PURCHASE_INTENT],
    ["เลขแทรกกิ้งอยู่ไหน", LineIntent.ORDER_STATUS],
    ["ของเครมได้ไหม", LineIntent.CLAIM_OR_RETURN],
    ["ร้านยุไหน", LineIntent.SHOP_INFO],
  ];
  for (const [text, expected] of cases) {
    const match = detectChatIntentTypo(text);
    assert.ok(match, `ต้องจับได้: ${text}`);
    assert.equal(match.intent, expected, text);
  }
});

test("tone-mark omission alone costs no edit budget", () => {
  // The whole 1-edit budget stays available for the real typo because the fold
  // removes tone marks on BOTH sides first.
  assert.equal(detectChatIntentTypo("โอนแลว")?.intent, LineIntent.PAYMENT_SLIP_IMAGE);
  assert.equal(detectChatIntentTypo("ชำรุด")?.intent, LineIntent.CLAIM_OR_RETURN);
});

test("does NOT fire on ordinary parts vocabulary", () => {
  // The exact failure this guard must never cause: a real product question being
  // answered as a claim / payment / shipping hand-off.
  const productTexts = [
    "คอยล์เย็น vios ปี 2015",
    "หม้อน้ำ d-max ราคาเท่าไหร่",
    "มีคอมแอร์ วีโก้ ไหม",
    "แผงแอร์ ฟอร์จูนเนอร์",
    "วาล์วแอร์ altis",
    "โอริง r134a",
    // Real catalog item one edit from bare "เคลม" — the reason that keyword is not
    // guarded. This must stay a product question forever.
    "แคลมป์รัดท่อ",
    "แคล้มรัดท่อ 2 นิ้ว",
    "น้ำยาล้างคอยล์",
    "มอเตอร์พัดลม city",
    "กรองแอร์ crv",
    "ใบพัดลม triton",
    "สายแอร์ใหญ่ สตาด้า 2500",
    "ฝาหม้อน้ำ ranger",
    "คอมแอร์ 508 24v",
    "ดรายเออร์ jazz",
    "บล็อควาล์ว revo",
  ];
  for (const text of productTexts) {
    assert.equal(detectChatIntentTypo(text), null, `ต้องไม่จับ: ${text}`);
  }
});

test("every literal rule still wins — the backstop never pre-empts them", () => {
  // Messages the router already classified must be untouched (same intent AND
  // matchedVia stays literal/undefined).
  const literal: Array<[string, LineIntent]> = [
    ["โอนแล้วนะคะ ส่งสลิป", LineIntent.PAYMENT_SLIP_IMAGE],
    ["ขอเคลมสินค้า", LineIntent.CLAIM_OR_RETURN],
    ["สวัสดีครับ", LineIntent.GREETING],
    ["ร้านเปิดกี่โมง", LineIntent.SHOP_INFO],
  ];
  for (const [text, expected] of literal) {
    const result = route(text);
    assert.equal(result.intent, expected, text);
    assert.notEqual(result.matchedVia, "typo", `${text} ต้องมาจาก literal rule`);
  }
});

test("the product default is preserved for anything the backstop does not claim", () => {
  const result = route("คอยล์เย็น vios ปี 2015");
  assert.equal(result.intent, LineIntent.PRODUCT_INQUIRY_TEXT);
  assert.equal(result.reason, "DEFAULT_PRODUCT_INQUIRY");
  assert.equal(result.allowsSearch, true);
});

test("a typo route carries the audit flag and the literal rule's reason", () => {
  const result = route("เครมของหน่อยครับ");
  assert.equal(result.intent, LineIntent.CLAIM_OR_RETURN);
  assert.equal(result.reason, "CLAIM_KEYWORD"); // identical to the literal rule
  assert.equal(result.matchedVia, "typo");
  // The compound form, not bare "เคลม" — see the collision note in the guard.
  assert.equal(result.matchedTypoKeyword, "เคลมของ");
  assert.equal(result.allowsSearch, false);
});

test("keyword list is non-empty and every entry clears the minimum length", () => {
  assert.ok(CHAT_INTENT_TYPO_KEYWORDS.length > 0);
  for (const entry of CHAT_INTENT_TYPO_KEYWORDS) {
    assert.ok(
      entry.folded.length >= 4,
      `${entry.keyword} สั้นเกินไปหลัง fold (${entry.folded})`,
    );
  }
});
