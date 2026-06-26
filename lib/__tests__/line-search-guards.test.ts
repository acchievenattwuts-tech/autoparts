import test from "node:test";
import assert from "node:assert/strict";

import { guardLineSearchIntent } from "@/lib/line-search-guards";
import type { LineSearchIntent } from "@/lib/line-ai-service";

const baseIntent = (over: Partial<LineSearchIntent>): LineSearchIntent => ({
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
  const { intent } = guardLineSearchIntent({
    intent: baseIntent({}),
    latestText: "วาล์ว โตโยต้า 134",
    history: [{ role: "customer", text: "พัดลมโบยาริสปี08" }],
  });
  assert.equal(intent?.year, null);
  assert.equal(intent?.carBrand, null);
  assert.equal(intent?.carModel, null);
});

test("keeps a year the customer actually typed", () => {
  const { intent } = guardLineSearchIntent({
    intent: baseIntent({ query: "วาล์วแอร์ 2008 134" }),
    latestText: "วาล์ว 2008 134",
    history: [],
  });
  assert.equal(intent?.year, 2008);
});

test("does not gate when there are no required tokens (early return preserves intent)", () => {
  const intentIn = baseIntent({ query: "วาล์วแอร์" });
  const { intent } = guardLineSearchIntent({
    intent: intentIn,
    latestText: "วาล์วแอร์",
    history: [],
  });
  // No model-code/year anchor → guard stays out of the way, year untouched.
  assert.equal(intent?.year, 2008);
});
