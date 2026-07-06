import test from "node:test";
import assert from "node:assert/strict";

import { normalizeInboundChatQuery } from "@/lib/chat-core/text-normalize";

test("splits a digit anchor glued onto a Thai word", () => {
  // The reported bug: "134" (R134a) fused to Thai letters never tokenized.
  assert.equal(normalizeInboundChatQuery("วาล์วโตโยต้า134"), "วาล์วโตโยต้า 134");
  assert.equal(normalizeInboundChatQuery("พัดลมโบยาริสปี08"), "พัดลมโบยาริสปี 08");
  assert.equal(normalizeInboundChatQuery("ปี08"), "ปี 08");
});

test("leaves Latin model codes that mix letters and digits intact", () => {
  assert.equal(normalizeInboundChatQuery("วาล์วแอร์ R134a"), "วาล์วแอร์ R134a");
  assert.equal(normalizeInboundChatQuery("STA-7065"), "STA-7065");
});

test("splits car model names glued to shorthand years", () => {
  assert.equal(normalizeInboundChatQuery("คอยเย็น Jazz08-12"), "คอยเย็น Jazz 08-12");
  assert.equal(normalizeInboundChatQuery("คอยเย็น city03"), "คอยเย็น city 03");
  assert.equal(normalizeInboundChatQuery("กรองแอร์ Vios13-19"), "กรองแอร์ Vios 13-19");
});

test("is idempotent and safe on empty / already-spaced input", () => {
  assert.equal(normalizeInboundChatQuery("วาล์ว โตโยต้า 134"), "วาล์ว โตโยต้า 134");
  assert.equal(normalizeInboundChatQuery(normalizeInboundChatQuery("วาล์วโตโยต้า134")), "วาล์วโตโยต้า 134");
  assert.equal(normalizeInboundChatQuery(""), "");
  assert.equal(normalizeInboundChatQuery(null), "");
  assert.equal(normalizeInboundChatQuery(undefined), "");
});
