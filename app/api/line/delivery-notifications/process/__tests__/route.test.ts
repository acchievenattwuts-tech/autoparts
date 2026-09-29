import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

let calls = 0;
let GET: typeof import("../route").GET;

before(async () => {
  mock.module("@/lib/line-delivery-worker", {
    namedExports: { processPendingSaleDeliveryLineDispatches: async () => { calls += 1; return 2; } },
  });
  GET = (await import("../route")).GET;
});

test("delivery recovery refuses missing or invalid cron secret before accessing jobs", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  for (const authorization of [null, "Bearer wrong", "Basic test-cron-secret"]) {
    const headers = authorization ? { authorization } : undefined;
    const response = await GET(new Request("https://shop.test/api/line/delivery-notifications/process", { headers }));
    assert.equal(response.status, 401);
  }
  assert.equal(calls, 0);
});

test("only authenticated recovery invokes the bounded worker", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  const response = await GET(new Request("https://shop.test/api/line/delivery-notifications/process", { headers: { authorization: "Bearer test-cron-secret" } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, processed: 2 });
  assert.equal(calls, 1);
});
