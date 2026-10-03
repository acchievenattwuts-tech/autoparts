import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

let checks = 0;
let checkError: Error | null = null;
let reportedScopes: string[] = [];
let GET: typeof import("../route").GET;

before(async () => {
  mock.module("@/lib/purchase-budget-alerts", {
    namedExports: {
      checkPurchaseBudgetAlert: async () => {
        checks += 1;
        if (checkError) throw checkError;
        return { checked: true, previous: "ok", current: "low", notified: true };
      },
    },
  });
  mock.module("@/lib/error-reporting", {
    namedExports: {
      reportCriticalError: async (_error: unknown, context: { scope: string }) => { reportedScopes.push(context.scope); },
    },
  });
  GET = (await import("../route")).GET;
});

beforeEach(() => {
  checks = 0;
  checkError = null;
  reportedScopes = [];
  process.env.CRON_SECRET = "test-cron-secret";
});

const request = (token?: string): Request =>
  new Request("https://example.test/api/purchase-budget/cron/check", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

test("rejects calls without the cron secret", async () => {
  const response = await GET(request());
  assert.equal(response.status, 401);
  assert.equal(checks, 0);

  const wrong = await GET(request("not-the-secret"));
  assert.equal(wrong.status, 401);
  assert.equal(checks, 0);
});

test("runs the alert check for Vercel Cron", async () => {
  const response = await GET(request("test-cron-secret"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, checked: true, previous: "ok", current: "low", notified: true });
  assert.equal(checks, 1);
});

test("reports a failed check and answers 500", async () => {
  checkError = new Error("db down");
  const response = await GET(request("test-cron-secret"));
  assert.equal(response.status, 500);
  assert.deepEqual(reportedScopes, ["cron.purchase_budget_alert"]);
});
