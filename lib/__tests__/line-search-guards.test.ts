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

test("drops ungrounded brand/year even without a required token", () => {
  // A plain Thai part word with no numeric anchor: the classifier's brand + year
  // (Toyota 2008) are pure hallucinations — the customer only typed the part. They
  // must be dropped so they can't hard-filter the search to the wrong brand/year
  // (they would otherwise also seed the LINE inquiry frame). The MODEL is left
  // alone here by design — model transliteration ("วีโก้"↔"Vigo") isn't in the
  // evidence data, so dropping it on a plain Thai turn would discard a model the
  // customer really typed.
  const { intent } = guardChatSearchIntent({
    intent: baseIntent({ query: "วาล์วแอร์" }),
    latestText: "วาล์วแอร์",
    history: [],
  });
  assert.equal(intent?.year, null);
  assert.equal(intent?.carBrand, null);
  assert.equal(intent?.partType, "วาล์วแอร์"); // part word is untouched
});

test("keeps a Thai-typed model without a required token (transliteration-safe)", () => {
  // The customer typed the model in Thai ("วีโก้") but the classifier returns the
  // Latin "Vigo"; with no numeric anchor the model must be KEPT so the search still
  // runs on the car — never re-ask for a car the customer already named.
  const { intent } = guardChatSearchIntent({
    intent: baseIntent({ query: "คอยเย็นวีโก้", carBrand: null, carModel: "Vigo", year: null }),
    latestText: "คอยเย็นวีโก้",
    history: [],
  });
  assert.equal(intent?.carModel, "Vigo");
});

test("grounds the model when a required-token anchor is present", () => {
  // With a model-code/year anchor in the text ("134"), the model IS grounded — a
  // model the customer never typed (classifier said Yaris) is dropped.
  const { intent } = guardChatSearchIntent({
    intent: baseIntent({ query: "วาล์วแอร์ 134", carBrand: null, carModel: "Yaris", year: null }),
    latestText: "วาล์ว 134",
    history: [],
  });
  assert.equal(intent?.carModel, null);
});
