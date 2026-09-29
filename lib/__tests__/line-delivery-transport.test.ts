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

test("timeout and temporary failure retry; permanent errors and bare 409 do not", async () => {
  for (const [status, retryable] of [[500, true], [429, true], [400, false], [401, false], [409, false]] as const) {
    const fetchMock = mock.method(globalThis, "fetch", async () => new Response(null, { status }));
    try {
      await assert.rejects(pushDeliveryLineCard(input), (e: unknown) => e instanceof DeliveryLinePushError && e.retryable === retryable && e.code === `LINE_HTTP_${status}`);
    } finally { fetchMock.mock.restore(); }
  }
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("network timeout with private response"); });
  try {
    await assert.rejects(pushDeliveryLineCard(input), (e: unknown) => e instanceof DeliveryLinePushError && e.retryable && e.message === "LINE_NETWORK_ERROR");
  } finally { fetchMock.mock.restore(); }
});

test("malformed persisted message never reaches LINE", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("must not call"); });
  try {
    await assert.rejects(pushDeliveryLineCard({ ...input, payload: {} }), (e: unknown) => e instanceof DeliveryLinePushError && e.code === "INVALID_PAYLOAD" && !e.retryable);
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally { fetchMock.mock.restore(); }
});
