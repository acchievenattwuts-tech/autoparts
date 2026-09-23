import assert from "node:assert/strict";
import test, { afterEach, before, mock } from "node:test";

// A malformed request (HTTP 400) or unknown model (404) is not a key-health
// problem: every key fails the same way. generateGeminiContent used to mark each
// key DISABLED on 400 and move on, so a few rejected customer images could
// disable the whole pool until an admin reset every key by hand.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

const calls: Array<{ fn: string; keyRef: string }> = [];
const KEYS = [
  { keyRef: "k1", secret: "s1" },
  { keyRef: "k2", secret: "s2" },
  { keyRef: "k3", secret: "s3" },
];

before(async () => {
  if (moduleMocksUnavailable) return;
  const record = (fn: string) => async (keyRef: string) => {
    calls.push({ fn, keyRef });
  };
  await mock.module("@/lib/google-ai-keys", {
    namedExports: {
      hasGeminiKeysConfigured: () => true,
      getAvailableGeminiKeys: async () => KEYS,
      markGeminiKeyDisabled: record("disabled"),
      markGeminiKeyRateLimited: record("rateLimited"),
      markGeminiKeySuccess: record("success"),
      markGeminiKeyTransientError: record("transient"),
    },
  });
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
});

function stubFetch(responses: Array<{ status: number; body: string }>) {
  let i = 0;
  globalThis.fetch = (async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return new Response(r.body, { status: r.status });
  }) as typeof fetch;
  return () => i;
}

const OK_BODY = JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });

test("400 malformed request aborts without disabling any key", { skip: moduleMocksUnavailable }, async () => {
  const { generateGeminiContent } = await import("@/lib/google-ai-client");
  const fetchCount = stubFetch([
    { status: 400, body: '{"error":{"status":"INVALID_ARGUMENT","message":"Unable to process input image."}}' },
  ]);

  await assert.rejects(
    generateGeminiContent({ prompt: "x" }),
    (error: Error) => error.name === "AllGeminiKeysExhaustedError" && /^GEMINI_REQUEST_ERROR:GEMINI_HTTP_400/.test(error.message),
  );
  assert.equal(fetchCount(), 1, "does not rotate through every key");
  assert.deepEqual(calls, [], "key state is untouched");
});

test("404 unknown model aborts without cooling down keys", { skip: moduleMocksUnavailable }, async () => {
  const { generateGeminiContent } = await import("@/lib/google-ai-client");
  const fetchCount = stubFetch([{ status: 404, body: '{"error":{"status":"NOT_FOUND"}}' }]);

  await assert.rejects(generateGeminiContent({ prompt: "x" }), /GEMINI_REQUEST_ERROR:GEMINI_HTTP_404/);
  assert.equal(fetchCount(), 1);
  assert.deepEqual(calls, []);
});

test("400 API_KEY_INVALID still disables that key and tries the next", { skip: moduleMocksUnavailable }, async () => {
  const { generateGeminiContent } = await import("@/lib/google-ai-client");
  stubFetch([
    {
      status: 400,
      body: '{"error":{"message":"API key not valid. Please pass a valid API key.","details":[{"reason":"API_KEY_INVALID"}]}}',
    },
    { status: 200, body: OK_BODY },
  ]);

  const result = await generateGeminiContent({ prompt: "x" });
  assert.equal(result.text, "ok");
  assert.equal(result.keyRef, "k2");
  assert.deepEqual(calls.filter((c) => c.fn === "disabled"), [{ fn: "disabled", keyRef: "k1" }]);
});

test("401/403 still disable the key", { skip: moduleMocksUnavailable }, async () => {
  const { generateGeminiContent } = await import("@/lib/google-ai-client");
  stubFetch([
    { status: 401, body: "unauthorized" },
    { status: 403, body: "forbidden" },
    { status: 200, body: OK_BODY },
  ]);

  const result = await generateGeminiContent({ prompt: "x" });
  assert.equal(result.keyRef, "k3");
  assert.deepEqual(
    calls.filter((c) => c.fn === "disabled").map((c) => c.keyRef),
    ["k1", "k2"],
  );
});

test("isGeminiInvalidKeyError recognises key errors only", { skip: moduleMocksUnavailable }, async () => {
  const { isGeminiInvalidKeyError } = await import("@/lib/google-ai-client");
  assert.equal(isGeminiInvalidKeyError('GEMINI_HTTP_400:{"reason":"API_KEY_INVALID"}'), true);
  assert.equal(isGeminiInvalidKeyError("GEMINI_HTTP_400:API key expired. Please renew the API key."), true);
  assert.equal(isGeminiInvalidKeyError("GEMINI_HTTP_400:Request payload size exceeds the limit"), false);
  assert.equal(isGeminiInvalidKeyError("GEMINI_HTTP_400:Unable to process input image."), false);
});
