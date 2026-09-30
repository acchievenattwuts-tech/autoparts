import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

let notificationCleanups = 0;
let dispatchCleanups = 0;
let dispatchCleanupError: Error | null = null;
let reportedScopes: string[] = [];
let logLines: string[] = [];
let GET: typeof import("../route").GET;

before(async () => {
  mock.module("@/lib/notifications", {
    namedExports: { cleanupOldNotifications: async () => { notificationCleanups += 1; return 4; } },
  });
  mock.module("@/lib/line-delivery-worker", {
    namedExports: {
      LINE_DELIVERY_DISPATCH_RETENTION_DAYS: 60,
      deleteExpiredSaleDeliveryDispatches: async () => {
        dispatchCleanups += 1;
        if (dispatchCleanupError) throw dispatchCleanupError;
        return 7;
      },
    },
  });
  mock.module("@/lib/error-reporting", {
    namedExports: { reportCriticalError: async (_error: unknown, context: { scope: string }) => { reportedScopes.push(context.scope); } },
  });
  GET = (await import("../route")).GET;
});

beforeEach(() => {
  notificationCleanups = 0;
  dispatchCleanups = 0;
  dispatchCleanupError = null;
  reportedScopes = [];
  logLines = [];
  process.env.CRON_SECRET = "test-cron-secret";
});

const authorized = (): Request =>
  new Request("https://shop.test/api/notifications/cron/cleanup", { headers: { authorization: "Bearer test-cron-secret" } });

test("cleanup refuses a missing or wrong cron secret before deleting anything", async () => {
  for (const authorization of [null, "Bearer wrong", "Basic test-cron-secret"]) {
    const headers = authorization ? { authorization } : undefined;
    const response = await GET(new Request("https://shop.test/api/notifications/cron/cleanup", { headers }));
    assert.equal(response.status, 401);
  }
  assert.equal(notificationCleanups + dispatchCleanups, 0);
});

test("one authorized run cleans notifications and expired LINE delivery dispatches, logging counts only", async () => {
  const logMock = mock.method(console, "log", (line: string) => { logLines.push(line); });
  try {
    const response = await GET(authorized());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true, retentionDays: 30, deleted: 4, lineDeliveryDispatchRetentionDays: 60, deletedLineDeliveryDispatches: 7,
    });
  } finally { logMock.mock.restore(); }
  assert.deepEqual([notificationCleanups, dispatchCleanups], [1, 1]);
  assert.deepEqual(logLines, [
    "[notification-cleanup] deleted 4 read notifications",
    "[notification-cleanup] deleted 7 LINE delivery dispatch rows",
  ]);
});

test("a dispatch cleanup failure is reported under its own scope", async () => {
  dispatchCleanupError = new Error("database unavailable");
  const logMock = mock.method(console, "log", () => undefined);
  try {
    const response = await GET(authorized());
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { ok: false, error: "LINE_DELIVERY_DISPATCH_CLEANUP_FAILED" });
  } finally { logMock.mock.restore(); }
  assert.deepEqual(reportedScopes, ["cron.line_delivery_dispatch_cleanup"]);
  assert.equal(notificationCleanups, 1);
});
