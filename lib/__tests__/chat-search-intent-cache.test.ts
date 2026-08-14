import test from "node:test";
import assert from "node:assert/strict";

import {
  buildChatSearchIntentCacheKey,
  clearChatSearchIntentCache,
  readChatSearchIntentCache,
  writeChatSearchIntentCache,
  CHAT_SEARCH_INTENT_CACHE_MAX_ENTRIES,
  CHAT_SEARCH_INTENT_CACHE_TTL_MS,
} from "@/lib/chat-core/search-intent-cache";
import type { ChatSearchIntent } from "@/lib/chat-core/ai-service";

const intent = (over: Partial<ChatSearchIntent> = {}): ChatSearchIntent => ({
  group: "product",
  query: "คอยล์เย็น vios",
  isProductQuery: true,
  partType: "คอยล์เย็น",
  carBrand: "Toyota",
  carModel: "Vios",
  year: 2015,
  partKind: "fitment",
  tooBroad: false,
  ...over,
});

test("round-trips a cached classification", () => {
  clearChatSearchIntentCache();
  const key = buildChatSearchIntentCacheKey({ latestText: "คอยล์เย็น vios ปี 2015", history: [] });
  assert.equal(readChatSearchIntentCache(key), null);
  writeChatSearchIntentCache(key, intent());
  assert.equal(readChatSearchIntentCache(key)?.carModel, "Vios");
});

test("the key covers the history, not just the latest text", () => {
  // The classifier consolidates the subject across turns, so the same latest text
  // under a different history is a DIFFERENT question and must not share an entry.
  const withoutHistory = buildChatSearchIntentCacheKey({ latestText: "ปี 2015", history: [] });
  const withHistory = buildChatSearchIntentCacheKey({
    latestText: "ปี 2015",
    history: [{ role: "customer", text: "คอยล์เย็น vios" }],
  });
  assert.notEqual(withoutHistory, withHistory);

  // Turn ORDER matters too.
  const orderA = buildChatSearchIntentCacheKey({
    latestText: "ปี 2015",
    history: [
      { role: "customer", text: "หม้อน้ำ" },
      { role: "customer", text: "vios" },
    ],
  });
  const orderB = buildChatSearchIntentCacheKey({
    latestText: "ปี 2015",
    history: [
      { role: "customer", text: "vios" },
      { role: "customer", text: "หม้อน้ำ" },
    ],
  });
  assert.notEqual(orderA, orderB);
});

test("the role is part of the key (shop turn vs customer turn)", () => {
  const asCustomer = buildChatSearchIntentCacheKey({
    latestText: "ok",
    history: [{ role: "customer", text: "vios" }],
  });
  const asShop = buildChatSearchIntentCacheKey({
    latestText: "ok",
    history: [{ role: "shop", text: "vios" }],
  });
  assert.notEqual(asCustomer, asShop);
});

test("a failed classification is NEVER cached", () => {
  // A null means Gemini timed out / returned junk. Caching it would pin a transient
  // outage onto the next few minutes of this customer's conversation.
  clearChatSearchIntentCache();
  const key = buildChatSearchIntentCacheKey({ latestText: "หม้อน้ำ d-max", history: [] });
  writeChatSearchIntentCache(key, null);
  assert.equal(readChatSearchIntentCache(key), null);
});

test("entries expire", () => {
  clearChatSearchIntentCache();
  const key = buildChatSearchIntentCacheKey({ latestText: "คอมแอร์ วีโก้", history: [] });
  const now = 1_000_000;
  writeChatSearchIntentCache(key, intent(), now);
  assert.ok(readChatSearchIntentCache(key, now + CHAT_SEARCH_INTENT_CACHE_TTL_MS - 1));
  assert.equal(readChatSearchIntentCache(key, now + CHAT_SEARCH_INTENT_CACHE_TTL_MS + 1), null);
});

test("a caller mutating the returned intent cannot corrupt the cache", () => {
  // The processor legitimately rewrites the intent (stock_availability → product);
  // that must not leak into what the NEXT turn reads back.
  clearChatSearchIntentCache();
  const key = buildChatSearchIntentCacheKey({ latestText: "มีคอยล์เย็นไหม", history: [] });
  writeChatSearchIntentCache(key, intent({ subjects: [] }));

  const first = readChatSearchIntentCache(key);
  assert.ok(first);
  first.group = "stock_availability";
  first.carModel = "MUTATED";
  first.subjects?.push({
    partType: "x",
    carBrand: null,
    carModel: null,
    year: null,
    partKind: null,
    query: "x",
  });

  const second = readChatSearchIntentCache(key);
  assert.equal(second?.group, "product");
  assert.equal(second?.carModel, "Vios");
  assert.equal(second?.subjects?.length, 0);
});

test("evicts the least-recently-used entry past the cap", () => {
  clearChatSearchIntentCache();
  for (let i = 0; i < CHAT_SEARCH_INTENT_CACHE_MAX_ENTRIES; i += 1) {
    writeChatSearchIntentCache(`key-${i}`, intent({ query: `q${i}` }));
  }
  // Touch the oldest so it is no longer the LRU victim.
  assert.ok(readChatSearchIntentCache("key-0"));
  writeChatSearchIntentCache("key-overflow", intent());

  assert.ok(readChatSearchIntentCache("key-0"), "recently read entry survives");
  assert.equal(readChatSearchIntentCache("key-1"), null, "true LRU entry is evicted");
  assert.ok(readChatSearchIntentCache("key-overflow"));
});
