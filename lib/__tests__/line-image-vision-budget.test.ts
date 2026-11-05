import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

import { IMAGE_READ_DEADLINE_MS } from "@/lib/chat-core/image-read-deadline";

// The import graph reaches lib/db.ts, which throws without a connection string.
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

// `mock.module` only exists when node runs with --experimental-test-module-mocks
// (npm test passes it). Skip instead of crashing under a plain `tsx --test`.
const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks — run via `npm test`";

type CapturedGeminiInput = {
  timeoutMs?: number;
  maxKeyAttempts?: number;
  fallbackModelOnOverload?: boolean;
};
const captured: CapturedGeminiInput[] = [];

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("@/lib/google-ai-client", {
    namedExports: {
      generateGeminiContent: async (input: CapturedGeminiInput) => {
        captured.push(input);
        return {
          text: '{"kind":"part_image","searchHints":["คอมแอร์"],"confidence":"HIGH","reason":"x"}',
          keyRef: "k1",
          model: "test",
        };
      },
    },
  });
  await mock.module("@/lib/google-ai-keys", {
    namedExports: { hasGeminiKeysConfigured: () => true },
  });
});

// 2026-11-04: vision allowed 20s × 3 keys on the same (hung) primary model = the
// whole 60s webhook budget, and six webhooks in a row were killed.
test(
  "vision call: worst case fits inside the image-read deadline and the retry uses the fallback model",
  { skip: moduleMocksUnavailable },
  async () => {
    const { classifyImageContent } = await import("@/lib/line-image-service");
    const result = await classifyImageContent({ mimeType: "image/jpeg", dataBase64: "AAAA" });

    assert.equal(result.kind, "part_image");
    const input = captured[0];
    assert.ok(input, "Gemini was called");
    assert.equal(input.fallbackModelOnOverload, true, "second try goes to the fallback model");
    assert.ok(input.timeoutMs && input.maxKeyAttempts, "timeout and key cap are both set");
    assert.ok(
      input.timeoutMs * input.maxKeyAttempts <= IMAGE_READ_DEADLINE_MS,
      `worst case ${input.timeoutMs * input.maxKeyAttempts}ms must fit in ${IMAGE_READ_DEADLINE_MS}ms`,
    );
  },
);
