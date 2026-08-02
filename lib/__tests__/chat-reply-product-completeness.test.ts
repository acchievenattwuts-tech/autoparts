import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

import { LineIntent } from "@/lib/generated/prisma";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

// ── Golden suite: the reply text and the Flex card carousel describe the SAME set.
// The cards are generated deterministically from the matched products; the prose
// is written by Gemini. On 2026-08-01 a "โบลเวอร์พัดลมแอร์ jazz" turn matched 4
// products and shipped 4 cards, but the model listed only the 2 whose names read
// "Honda" — leaving two Toyota-named cards the customer was never told about.
// Judging fit is the shop's call, so the text must carry every card.

// ai-service caches its imports of the Gemini client, so the mocks must be in
// place before ANY test imports it — otherwise the first import wins and later
// mock.module calls are ignored. One shared mock reads the per-test reply.
let geminiReply = "";
before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("@/lib/google-ai-keys", {
    namedExports: { hasGeminiKeysConfigured: () => true },
  });
  await mock.module("@/lib/google-ai-client", {
    namedExports: {
      generateGeminiContent: async () => ({ keyRef: "test-key", text: geminiReply }),
    },
  });
});

const product = (code: string, name: string) => ({
  id: `id-${code}`,
  code,
  name,
  imageUrl: null,
  salePrice: 1000,
  retailPrice: 1000,
  memberPrice: 1000,
});

const FOUR_MATCHES = [
  product("P0240", "โบลเวอร์แอร์ Honda Jazz 2003 / City 2003 12V JT"),
  product("P0119", "โบลเวอร์มอเตอร์ HONDA CITY 09-13 / Jazz 08-13 STAL STF-2030"),
  product("P0109", "โบเวอร์มอเตอร์ Toyota Hilux Vigo 2005-2014 STAL 12V STF-2027"),
  product("P0419", "โบเวอร์แอร์ Toyota Vigo 2004-2014 / Fortuner 2005-2014 Denso"),
];

test("completeness check passes only when every matched product is named", async () => {
  const { chatReplyListsEveryProduct } = await import("@/lib/chat-core/ai-service");

  assert.equal(
    chatReplyListsEveryProduct("1️⃣ A\n🏷️ P0240\n2️⃣ B\n🏷️ P0119", FOUR_MATCHES.slice(0, 2)),
    true,
    "all codes present",
  );
  // The exact 2026-08-01 shape: two of four listed.
  assert.equal(
    chatReplyListsEveryProduct("1️⃣ A\n🏷️ P0240\n2️⃣ B\n🏷️ P0119", FOUR_MATCHES),
    false,
    "two cards would have no matching line in the text",
  );
  assert.equal(chatReplyListsEveryProduct("ไม่พบรายการค่ะ", []), true, "no products, nothing to check");
  assert.equal(chatReplyListsEveryProduct("ไม่พบรายการค่ะ", undefined), true, "undefined is not a mismatch");
  assert.equal(
    chatReplyListsEveryProduct("รหัส p0240 และ p0119 ค่ะ", FOUR_MATCHES.slice(0, 2)),
    true,
    "code matching is case-insensitive",
  );
  // A product with no code is matched on its name instead, so it is still covered.
  assert.equal(
    chatReplyListsEveryProduct("มีโบลเวอร์แอร์รุ่นพิเศษค่ะ", [
      { ...product("", "โบลเวอร์แอร์รุ่นพิเศษ"), code: "" },
    ]),
    true,
    "codeless product matched by name",
  );
  assert.equal(
    chatReplyListsEveryProduct("มีของค่ะ", [{ ...product("", "โบลเวอร์แอร์รุ่นพิเศษ"), code: "" }]),
    false,
    "codeless product absent from the text",
  );
});

test(
  "a Gemini reply that drops matched products falls back to the complete list",
  { skip: moduleMocksUnavailable },
  async () => {
    // Mimics the incident: only the two Honda-named rows are written up.
    geminiReply =
      "สำหรับโบลเวอร์ Honda Jazz มีดังนี้ค่ะ\n\n1️⃣ ตัวแรก\n🏷️ P0240  |  💰 ฿1,250\n2️⃣ ตัวที่สอง\n🏷️ P0119  |  💰 ฿1,180";

    const { generateChatSuggestion } = await import("@/lib/chat-core/ai-service");
    const result = await generateChatSuggestion({
      intent: LineIntent.PRODUCT_INQUIRY_TEXT,
      originalText: "โบลเวอร์พัดลมแอร์ jazz มีสต็อกไหมค่ะ",
      productSearch: {
        searched: true,
        reason: "SEARCHED_PRODUCT_INQUIRY",
        query: "โบลเวอร์ Honda Jazz",
        needsMoreInfo: false,
        result: { ids: FOUR_MATCHES.map((p) => p.id), total: 4, mode: "v2", matchReasons: {} },
      } as Parameters<typeof generateChatSuggestion>[0]["productSearch"],
      products: FOUR_MATCHES,
    });

    for (const p of FOUR_MATCHES) {
      assert.ok(
        result.suggestedReply.includes(p.code),
        `${p.code} must appear in the reply that ships beside its card`,
      );
    }
    assert.match(
      result.reasoningSummary ?? "",
      /omitted matched products/,
      "the fallback is recorded so the rate is auditable",
    );
  },
);

test(
  "a Gemini reply that lists every product is used as written",
  { skip: moduleMocksUnavailable },
  async () => {
    const geminiText =
      "รายการที่ใกล้เคียงค่ะ\n\n1️⃣ A\n🏷️ P0240\n2️⃣ B\n🏷️ P0119\n3️⃣ C\n🏷️ P0109\n4️⃣ D\n🏷️ P0419";
    geminiReply = geminiText;

    const { generateChatSuggestion } = await import("@/lib/chat-core/ai-service");
    const result = await generateChatSuggestion({
      intent: LineIntent.PRODUCT_INQUIRY_TEXT,
      originalText: "โบลเวอร์พัดลมแอร์ jazz มีสต็อกไหมค่ะ",
      productSearch: {
        searched: true,
        reason: "SEARCHED_PRODUCT_INQUIRY",
        query: "โบลเวอร์ Honda Jazz",
        needsMoreInfo: false,
        result: { ids: FOUR_MATCHES.map((p) => p.id), total: 4, mode: "v2", matchReasons: {} },
      } as Parameters<typeof generateChatSuggestion>[0]["productSearch"],
      products: FOUR_MATCHES,
    });

    assert.equal(result.suggestedReply, geminiText, "จูน's own wording is preserved when it is complete");
  },
);

test("the prompt tells the model it may not drop a matched product", async () => {
  const { buildLineReplyPromptForTest } = await import("@/lib/chat-core/ai-service");
  const prompt = buildLineReplyPromptForTest({
    intent: LineIntent.PRODUCT_INQUIRY_TEXT,
    originalText: "โบลเวอร์ jazz",
    products: FOUR_MATCHES,
  });
  assert.match(prompt, /ครบทุกรายการ/, "completeness rule is stated");
  assert.match(prompt, /ตามลำดับที่ให้มาเป๊ะ/, "the pre-existing ordering rule is still there");
});
