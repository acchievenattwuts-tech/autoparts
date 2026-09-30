import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

let calls = 0;
let workerError: Error | null = null;
let GET: typeof import("../route").GET;

before(async () => {
  mock.module("@/lib/line-delivery-worker", {
    namedExports: {
      processPendingSaleDeliveryLineDispatches: async () => {
        calls += 1;
        if (workerError) throw workerError;
        return 2;
      },
    },
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

test("a failed recovery run returns 500 and logs only an error code, never the error message", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  workerError = Object.assign(new Error("row for U0123456789abcdef0123456789abcdef failed"), { code: "P2024" });
  const logged: unknown[][] = [];
  const errorMock = mock.method(console, "error", (...args: unknown[]) => { logged.push(args); });
  try {
    const response = await GET(new Request("https://shop.test/api/line/delivery-notifications/process", { headers: { authorization: "Bearer test-cron-secret" } }));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { ok: false, error: "RECOVERY_FAILED" });
  } finally { errorMock.mock.restore(); workerError = null; }
  assert.deepEqual(logged, [["[line-delivery] recovery failed", { code: "P2024" }]]);
});
