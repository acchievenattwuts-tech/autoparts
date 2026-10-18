import assert from "node:assert/strict";
import test, { afterEach, before, beforeEach, mock } from "node:test";

// A Gemini capacity spike is per model: every key of the overloaded model returns
// 503 / times out together (LINE 2026-10-12..18), so a chat call that retried the
// same model on its second key failed too. Chat calls now opt into a fallback
// model for the second attempt.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

const KEYS = [
  { keyRef: "k1", secret: "s1" },
  { keyRef: "k2", secret: "s2" },
  { keyRef: "k3", secret: "s3" },
];

before(async () => {
  if (moduleMocksUnavailable) return;
  const noop = async () => undefined;
  await mock.module("@/lib/google-ai-keys", {
    namedExports: {
      hasGeminiKeysConfigured: () => true,
      getAvailableGeminiKeys: async () => KEYS,
      markGeminiKeyDisabled: noop,
      markGeminiKeyRateLimited: noop,
      markGeminiKeySuccess: noop,
      markGeminiKeyTransientError: noop,
    },
  });
});

const realFetch = globalThis.fetch;
const realWarn = console.warn;
beforeEach(async () => {
  process.env.GOOGLE_AI_MODEL = "primary-lite";
  process.env.GOOGLE_AI_FALLBACK_MODEL = "fallback-flash";
  delete process.env.GOOGLE_AI_FALLBACK_THINKING_LEVEL;
  console.warn = () => undefined;
  if (moduleMocksUnavailable) return;
  const { resetGeminiModelFallbackStateForTest } = await import("@/lib/google-ai-client");
  resetGeminiModelFallbackStateForTest();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
  delete process.env.GOOGLE_AI_MODEL;
  delete process.env.GOOGLE_AI_FALLBACK_MODEL;
});

type SeenRequest = { model: string; thinkingLevel: string | null };
type StubResponse = { status: number; body?: string } | "abort";

const OK_BODY = JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });
const OVERLOADED = { status: 503, body: '{"error":{"code":503,"message":"high demand"}}' };

function stubFetch(responses: StubResponse[]): SeenRequest[] {
  const seen: SeenRequest[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const model = decodeURIComponent(String(url).match(/models\/([^:]+):/)?.[1] ?? "");
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      generationConfig?: { thinkingConfig?: { thinkingLevel?: string } };
    };
    seen.push({ model, thinkingLevel: body.generationConfig?.thinkingConfig?.thinkingLevel ?? null });
    const next = responses[Math.min(seen.length - 1, responses.length - 1)];
    if (next === "abort") {
      throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    }
    return new Response(next.body ?? OK_BODY, { status: next.status });
  }) as typeof fetch;
  return seen;
}

const CHAT_CALL = {
  prompt: "x",
  thinkingLevel: "NONE" as const,
  maxKeyAttempts: 2,
  fallbackModelOnOverload: true,
};

test("chat call: a 503 on the primary retries on the fallback model with LOW thinking", { skip: moduleMocksUnavailable }, async () => {
  const { generateGeminiContent } = await import("@/lib/google-ai-client");
  const seen = stubFetch([OVERLOADED, { status: 200 }]);

  const result = await generateGeminiContent(CHAT_CALL);

  assert.equal(result.text, "ok");
  assert.equal(result.model, "fallback-flash");
  assert.deepEqual(seen, [
    { model: "primary-lite", thinkingLevel: null },
    { model: "fallback-flash", thinkingLevel: "LOW" },
  ]);
});

test("chat call: a timeout on the primary also moves to the fallback", { skip: moduleMocksUnavailable }, async () => {
  const { generateGeminiContent } = await import("@/lib/google-ai-client");
  const seen = stubFetch(["abort", { status: 200 }]);

  const result = await generateGeminiContent(CHAT_CALL);

  assert.equal(result.model, "fallback-flash");
  assert.deepEqual(seen.map((request) => request.model), ["primary-lite", "fallback-flash"]);
});

test("after an overload the next chat call starts on the fallback", { skip: moduleMocksUnavailable }, async () => {
  const { generateGeminiContent } = await import("@/lib/google-ai-client");
  stubFetch([OVERLOADED, { status: 200 }]);
  await generateGeminiContent(CHAT_CALL);

  const seen = stubFetch([{ status: 200 }]);
  const result = await generateGeminiContent(CHAT_CALL);

  assert.equal(result.model, "fallback-flash");
  assert.deepEqual(seen.map((request) => request.model), ["fallback-flash"], "no timeout burned on the primary");
});

test("a 429 is a key problem: the next key keeps the primary model", { skip: moduleMocksUnavailable }, async () => {
  const { generateGeminiContent } = await import("@/lib/google-ai-client");
  const seen = stubFetch([{ status: 429, body: '{"error":"PerMinute"}' }, { status: 200 }]);

  const result = await generateGeminiContent(CHAT_CALL);

  assert.equal(result.model, "primary-lite");
  assert.deepEqual(seen.map((request) => request.model), ["primary-lite", "primary-lite"]);
});

test("a fallback that rejects the request (404) hands back to the primary and is skipped", { skip: moduleMocksUnavailable }, async () => {
  const { generateGeminiContent } = await import("@/lib/google-ai-client");
  // Open the overload window so the fallback leads, then let it 404.
  stubFetch([OVERLOADED, OVERLOADED]);
  await assert.rejects(generateGeminiContent(CHAT_CALL), /ALL_GEMINI_KEYS_FAILED/);

  const seen = stubFetch([{ status: 404, body: '{"error":{"status":"NOT_FOUND"}}' }, { status: 200 }]);
  const result = await generateGeminiContent(CHAT_CALL);
  assert.equal(result.model, "primary-lite");
  assert.deepEqual(seen.map((request) => request.model), ["fallback-flash", "primary-lite"]);

  const later = stubFetch([OVERLOADED, { status: 200 }]);
  await generateGeminiContent(CHAT_CALL);
  assert.deepEqual(
    later.map((request) => request.model),
    ["primary-lite", "primary-lite"],
    "a rejected fallback is not retried on every call",
  );
});

test("background calls (no opt-in) keep a single model", { skip: moduleMocksUnavailable }, async () => {
  const { generateGeminiContent } = await import("@/lib/google-ai-client");
  const seen = stubFetch([OVERLOADED, { status: 200 }]);

  const result = await generateGeminiContent({ prompt: "x", thinkingLevel: "NONE" });

  assert.equal(result.model, "primary-lite");
  assert.deepEqual(seen.map((request) => request.model), ["primary-lite", "primary-lite"]);
});

test("GOOGLE_AI_FALLBACK_MODEL=off disables the switch", { skip: moduleMocksUnavailable }, async () => {
  process.env.GOOGLE_AI_FALLBACK_MODEL = "off";
  const { generateGeminiContent } = await import("@/lib/google-ai-client");
  const seen = stubFetch([OVERLOADED, { status: 200 }]);

  await generateGeminiContent(CHAT_CALL);

  assert.deepEqual(seen.map((request) => request.model), ["primary-lite", "primary-lite"]);
});
