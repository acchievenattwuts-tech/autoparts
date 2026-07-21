import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { LineIntent } from "@/lib/generated/prisma";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

test(
  "multi-subject intent requests enough JSON output without changing the parsed search subjects",
  { skip: moduleMocksUnavailable },
  async () => {
    const capturedInputs: Array<Record<string, unknown>> = [];
    await mock.module("@/lib/google-ai-client", {
      namedExports: {
        generateGeminiContent: async (input: Record<string, unknown>) => {
          capturedInputs.push(input);
          return {
            keyRef: "test-key",
            text: JSON.stringify({
              group: "product",
              query: "วาล์ว ไดรเออร์ Mitsubishi Triton 2013",
              isProductQuery: true,
              partType: "วาล์วแอร์",
              carBrand: "Mitsubishi",
              carModel: "Triton",
              year: 2013,
              partKind: "fitment",
              tooBroad: false,
              subjects: [
                {
                  partType: "วาล์วแอร์",
                  carBrand: "Mitsubishi",
                  carModel: "Triton",
                  year: 2013,
                  partKind: "fitment",
                  query: "วาล์วแอร์ Mitsubishi Triton 2013",
                },
                {
                  partType: "ไดรเออร์",
                  carBrand: "Mitsubishi",
                  carModel: "Triton",
                  year: 2013,
                  partKind: "fitment",
                  query: "ไดรเออร์ Mitsubishi Triton 2013",
                },
              ],
            }),
          };
        },
      },
    });
    await mock.module("@/lib/google-ai-keys", {
      namedExports: { hasGeminiKeysConfigured: () => true },
    });

    const { CHAT_SEARCH_INTENT_MAX_OUTPUT_TOKENS, extractChatSearchIntent } =
      await import("@/lib/chat-core/ai-service");
    const intent = await extractChatSearchIntent({
      intent: LineIntent.PRODUCT_INQUIRY_TEXT,
      latestText: "วาล์ว/ไดรเออร์มิตซูไททันปี13",
      history: [],
    });
    const captured = capturedInputs[0];

    assert.equal(CHAT_SEARCH_INTENT_MAX_OUTPUT_TOKENS, 512);
    assert.equal(captured.maxOutputTokens, 512);
    assert.equal(captured.json, true);
    assert.equal(captured.temperature, 0);
    assert.equal(captured.thinkingLevel, "NONE");
    assert.deepEqual(
      intent?.subjects?.map((subject) => subject.partType),
      ["วาล์วแอร์", "ไดรเออร์"],
    );
    assert.equal(intent?.carModel, "Triton");
    assert.equal(intent?.year, 2013);
  },
);
