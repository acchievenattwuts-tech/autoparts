import test from "node:test";
import assert from "node:assert/strict";

import { guardChatSearchIntent } from "@/lib/chat-core/search-guards";
import type { ChatSearchIntent } from "@/lib/chat-core/ai-service";

const baseIntent = (over: Partial<ChatSearchIntent>): ChatSearchIntent => ({
  group: "product",
  query: "วาล์วแอร์ 134",
  isProductQuery: true,
  partType: "วาล์วแอร์",
  carBrand: "Toyota",
  carModel: "Yaris",
  year: 2008,
  partKind: null,
  tooBroad: false,
  ...over,
});

test("drops a year the customer never typed in this session", () => {
  // "ปี08" in history is NOT evidence for the 4-digit year 2008 → must be gated
  // off so it can't hard-filter a fresh query to the wrong year.
  const { intent } = guardChatSearchIntent({
    intent: baseIntent({}),
    latestText: "วาล์ว โตโยต้า 134",
    history: [{ role: "customer", text: "พัดลมโบยาริสปี08" }],
  });
  assert.equal(intent?.year, null); // "ปี08" never grounds the 4-digit 2008
  assert.equal(intent?.carBrand, "Toyota"); // Thai "โตโยต้า" grounds the English brand
  assert.equal(intent?.carModel, null); // "Yaris" not in this turn's text
});

test("Thai brand name grounds the English classifier value", () => {
  for (const [thai, eng] of [["นิสสัน", "Nissan"], ["อีซูซุ", "Isuzu"], ["ฮอนด้า", "Honda"]] as const) {
    const { intent } = guardChatSearchIntent({
      intent: baseIntent({ carBrand: eng, carModel: null, query: `วาล์วแอร์ 134` }),
      latestText: `วาล์ว ${thai} 134`,
      history: [],
    });
    assert.equal(intent?.carBrand, eng, `${thai} → ${eng}`);
  }
});

test("does not ground a brand the customer did not mention", () => {
  const { intent } = guardChatSearchIntent({
    intent: baseIntent({ carBrand: "Toyota", carModel: null, query: "วาล์วแอร์ 134" }),
    latestText: "วาล์ว นิสสัน 134", // customer said Nissan, classifier wrongly said Toyota
    history: [],
  });
  assert.equal(intent?.carBrand, null);
});

test("keeps a year the customer actually typed", () => {
  const { intent } = guardChatSearchIntent({
    intent: baseIntent({ query: "วาล์วแอร์ 2008 134" }),
    latestText: "วาล์ว 2008 134",
    history: [],
  });
  assert.equal(intent?.year, 2008);
});

test("does not gate when there are no required tokens (early return preserves intent)", () => {
  const intentIn = baseIntent({ query: "วาล์วแอร์" });
  const { intent } = guardChatSearchIntent({
    intent: intentIn,
    latestText: "วาล์วแอร์",
    history: [],
  });
  // No model-code/year anchor → guard stays out of the way, year untouched.
  assert.equal(intent?.year, 2008);
});
