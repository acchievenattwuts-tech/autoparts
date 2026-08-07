import test from "node:test";
import assert from "node:assert/strict";

import { LineIntent } from "@/lib/generated/prisma";
import { searchChatProductInquiry } from "@/lib/chat-core/product-search-bridge";
import type { ChatIntentRouteResult } from "@/lib/chat-core/intent-router";

const searchableRoute: ChatIntentRouteResult = {
  intent: LineIntent.PRODUCT_INQUIRY_TEXT,
  allowsSearch: true,
  requiresAdmin: false,
  requiresImageAnalysis: false,
  requiresMoreInfo: false,
  reason: "GOLDEN_PRODUCT_CODE_GROUNDING",
};

const cases = [
  { customerText: "คอมแอร์508", rewrittenQuery: "คอมแอร์", required: ["508"] },
  { customerText: "วาล์ว709", rewrittenQuery: "วาล์ว", required: ["709"] },
  { customerText: "คอมแอร์ STA-7065", rewrittenQuery: "คอมแอร์", required: ["sta-7065"] },
  { customerText: "คอมแอร์ SD508", rewrittenQuery: "คอมแอร์", required: ["sd508"] },
  { customerText: "คอมแอร์ 10PA", rewrittenQuery: "คอมแอร์", required: ["10pa"] },
] as const;

test("golden: customer-authored product codes survive every rewritten catalog query", async () => {
  for (const golden of cases) {
    const calls: Array<{ query?: string | null; requiredTokens?: string[] | null }> = [];
    const result = await searchChatProductInquiry(
      {
        route: searchableRoute,
        text: golden.rewrittenQuery,
        customerText: golden.customerText,
      },
      async (input) => {
        calls.push(input);
        return { ids: ["matched-product"], total: 1, mode: "v2" };
      },
    );

    assert.equal(result.searched, true, golden.customerText);
    assert.equal(calls.length, 1, golden.customerText);
    assert.equal(calls[0]?.query, golden.rewrittenQuery, golden.customerText);
    assert.deepEqual(calls[0]?.requiredTokens, [...golden.required], golden.customerText);
  }
});

test("golden: code constraints remain mandatory through did-you-mean and end at zero", async () => {
  const calls: Array<{ query?: string | null; requiredTokens?: string[] | null }> = [];
  const result = await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "คอมแอร์",
      customerText: "คอมแอร์508",
    },
    async (input) => {
      calls.push(input);
      return { ids: [], total: 0, mode: "v2" };
    },
    async () => ["คอมเพรสเซอร์"],
  );

  assert.equal(result.searched, true);
  assert.equal(result.result.total, 0);
  assert.deepEqual(calls.map((call) => call.query), ["คอมแอร์", "คอมเพรสเซอร์"]);
  assert.deepEqual(
    calls.map((call) => call.requiredTokens),
    [["508"], ["508"]],
    "spelling recovery must never broaden away from a customer-authored code",
  );
});

test("golden: years, year ranges, and generation labels do not become product-code anchors", async () => {
  const calls: Array<{ requiredTokens?: string[] | null }> = [];
  await searchChatProductInquiry(
    {
      route: searchableRoute,
      text: "คอมแอร์",
      customerText: "คอมแอร์ Gen3 ปี 2012 ช่วง 12-15",
    },
    async (input) => {
      calls.push(input);
      return { ids: ["matched-product"], total: 1, mode: "v2" };
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.requiredTokens, undefined);
});
