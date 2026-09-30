import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { DeliveryLinePushError, pushDeliveryLineCard } from "@/lib/line-delivery-transport";

const input = { accessToken: "test-token", recipientId: "line1", retryKey: "e5d8e2f3-2107-4d39-a690-7f8e4b03247c", payload: { type: "flex", altText: "delivery", contents: { type: "bubble" } } };

test("LINE acceptance and duplicate-key acceptance preserve request identity", async () => {
  const bodies: string[] = [];
  const keys: string[] = [];
  let attempt = 0;
  const fetchMock = mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    bodies.push(String(init.body));
    keys.push(new Headers(init.headers).get("X-Line-Retry-Key") ?? "");
    attempt += 1;
    return attempt === 1 ? new Response(null, { status: 200, headers: { "x-line-request-id": "req1" } })
      : new Response(null, { status: 409, headers: { "x-line-accepted-request-id": "req1" } });
  });
  try {
    assert.deepEqual(await pushDeliveryLineCard(input), { requestId: "req1" });
    assert.deepEqual(await pushDeliveryLineCard(input), { requestId: "req1" });
    assert.deepEqual(keys, [input.retryKey, input.retryKey]);
    assert.equal(bodies[0], bodies[1]);
  } finally { fetchMock.mock.restore(); }
});

test("every non-accepted response, network error and timeout rejects with a code only, after one HTTP call", async () => {
  for (const status of [500, 503, 429, 400, 401, 409]) {
    const fetchMock = mock.method(globalThis, "fetch", async () => new Response(null, { status }));
    try {
      await assert.rejects(pushDeliveryLineCard(input), (e: unknown) => e instanceof DeliveryLinePushError && e.code === `LINE_HTTP_${status}`);
      assert.equal(fetchMock.mock.callCount(), 1);
    } finally { fetchMock.mock.restore(); }
  }
  for (const thrown of [new Error("network failure with private response"), new DOMException("The operation was aborted due to timeout", "TimeoutError")]) {
    const fetchMock = mock.method(globalThis, "fetch", async () => { throw thrown; });
    try {
      await assert.rejects(pushDeliveryLineCard(input), (e: unknown) => e instanceof DeliveryLinePushError && e.message === "LINE_NETWORK_ERROR");
      assert.equal(fetchMock.mock.callCount(), 1);
    } finally { fetchMock.mock.restore(); }
  }
});

test("malformed persisted message never reaches LINE", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("must not call"); });
  try {
    await assert.rejects(pushDeliveryLineCard({ ...input, payload: {} }), (e: unknown) => e instanceof DeliveryLinePushError && e.code === "INVALID_PAYLOAD");
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally { fetchMock.mock.restore(); }
});
