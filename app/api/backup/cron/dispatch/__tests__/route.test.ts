import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

type DispatchResult = Error | null;

let dispatchResults: DispatchResult[] = [];
let dispatchTriggers: string[] = [];
let reportedScopes: string[] = [];
let auditEntries: Array<Record<string, unknown>> = [];
let GET: typeof import("../route").GET;

before(async () => {
  mock.module("@/lib/github-backup", {
    namedExports: {
      dispatchGithubBackup: async (trigger: string) => {
        dispatchTriggers.push(trigger);
        const result = dispatchResults.shift() ?? null;
        if (result) throw result;
      },
    },
  });
  mock.module("@/lib/error-reporting", {
    namedExports: {
      reportCriticalError: async (_error: unknown, context: { scope: string }) => { reportedScopes.push(context.scope); },
    },
  });
  mock.module("@/lib/audit-log", {
    namedExports: {
      safeWriteAuditLog: async (entry: Record<string, unknown>) => { auditEntries.push(entry); },
    },
  });
  mock.module("@/lib/generated/prisma", {
    namedExports: { AuditAction: { EXPORT: "EXPORT" } },
  });
  GET = (await import("../route")).GET;
});

beforeEach(() => {
  dispatchResults = [];
  dispatchTriggers = [];
  reportedScopes = [];
  auditEntries = [];
  process.env.CRON_SECRET = "test-cron-secret";
});

const URL_PATH = "https://shop.test/api/backup/cron/dispatch";
const authorized = (): Request => new Request(URL_PATH, { headers: { authorization: "Bearer test-cron-secret" } });

/** Skip the real retry delay and keep the expected retry log out of test output. */
const runQuietly = async (t: test.TestContext): Promise<Response> => {
  t.mock.method(globalThis, "setTimeout", (callback: () => void) => { callback(); return 0; });
  t.mock.method(console, "error", () => undefined);
  return GET(authorized());
};

test("refuses a missing or wrong cron secret before dispatching", async () => {
  for (const authorization of [null, "Bearer wrong", "Basic test-cron-secret"]) {
    const headers = authorization ? { authorization } : undefined;
    const response = await GET(new Request(URL_PATH, { headers }));
    assert.equal(response.status, 401);
  }
  assert.equal(dispatchTriggers.length, 0);
});

test("dispatches a scheduled run once and audits it", async () => {
  const response = await GET(authorized());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, attempts: 1 });
  assert.deepEqual(dispatchTriggers, ["scheduled"]);
  assert.equal(auditEntries.length, 1);
  assert.deepEqual(auditEntries[0]?.after, { trigger: "scheduled", workflow: "backup.yml" });
  assert.deepEqual(reportedScopes, []);
});

test("retries a transient dispatch failure once", async (t) => {
  dispatchResults = [new Error("GITHUB_BACKUP_DISPATCH_FAILED:502")];

  const response = await runQuietly(t);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, attempts: 2 });
  assert.equal(dispatchTriggers.length, 2);
  assert.deepEqual(reportedScopes, []);
});

test("does not retry a bad token and alerts Telegram", async (t) => {
  dispatchResults = [new Error("GITHUB_BACKUP_UNAUTHORIZED")];

  const response = await runQuietly(t);

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { ok: false, error: "BACKUP_DISPATCH_FAILED" });
  assert.equal(dispatchTriggers.length, 1);
  assert.deepEqual(reportedScopes, ["cron.backup_dispatch"]);
  assert.equal(auditEntries.length, 0);
});

test("alerts Telegram when the retry also fails", async (t) => {
  dispatchResults = [new Error("timeout"), new Error("timeout")];

  const response = await runQuietly(t);

  assert.equal(response.status, 500);
  assert.equal(dispatchTriggers.length, 2);
  assert.deepEqual(reportedScopes, ["cron.backup_dispatch"]);
  assert.equal(auditEntries.length, 0);
});
