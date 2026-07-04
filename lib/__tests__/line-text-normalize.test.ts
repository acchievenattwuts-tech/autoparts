import test from "node:test";
import assert from "node:assert/strict";

import { normalizeInboundLineQuery } from "@/lib/chat-core/text-normalize";

test("splits a digit anchor glued onto a Thai word", () => {
  // The reported bug: "134" (R134a) fused to Thai letters never tokenized.
  assert.equal(normalizeInboundLineQuery("วาล์วโตโยต้า134"), "วาล์วโตโยต้า 134");
  assert.equal(normalizeInboundLineQuery("พัดลมโบยาริสปี08"), "พัดลมโบยาริสปี 08");
  assert.equal(normalizeInboundLineQuery("ปี08"), "ปี 08");
});

test("leaves Latin model codes that mix letters and digits intact", () => {
  assert.equal(normalizeInboundLineQuery("วาล์วแอร์ R134a"), "วาล์วแอร์ R134a");
  assert.equal(normalizeInboundLineQuery("STA-7065"), "STA-7065");
});

test("is idempotent and safe on empty / already-spaced input", () => {
  assert.equal(normalizeInboundLineQuery("วาล์ว โตโยต้า 134"), "วาล์ว โตโยต้า 134");
  assert.equal(normalizeInboundLineQuery(normalizeInboundLineQuery("วาล์วโตโยต้า134")), "วาล์วโตโยต้า 134");
  assert.equal(normalizeInboundLineQuery(""), "");
  assert.equal(normalizeInboundLineQuery(null), "");
  assert.equal(normalizeInboundLineQuery(undefined), "");
});
