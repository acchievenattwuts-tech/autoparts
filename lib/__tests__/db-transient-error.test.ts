import test from "node:test";
import assert from "node:assert/strict";

import { isTransientDbError, withDbRetry } from "../db";

// Verbatim wording from the two production failures on 11-12 Aug 2026 (Vercel
// logs): a background ISR revalidation of `admin-master-car-brands-v1` and of
// `storefront-products-landing-products`. Both are connection-level faults that
// never reached Postgres, so withDbRetry must treat them as retryable.
const SUPAVISOR_AUTH_TIMEOUT_MESSAGE = "(EAUTHTIMEOUT) timeout while waiting for message";
const CONNECT_TIMEOUT_MESSAGE = "Connection terminated due to connection timeout";

/** Mirrors Prisma's DriverAdapterError: `cause` is a plain object, not an Error. */
const makeDriverAdapterError = (message: string): Error =>
  Object.assign(new Error(message), {
    cause: {
      originalCode: "08006",
      originalMessage: message,
      kind: "postgres",
      code: "08006",
      severity: "FATAL",
      message,
    },
  });

test("isTransientDbError matches the Supavisor auth-handshake timeout", () => {
  assert.equal(isTransientDbError(new Error(SUPAVISOR_AUTH_TIMEOUT_MESSAGE)), true);
  assert.equal(isTransientDbError(makeDriverAdapterError(SUPAVISOR_AUTH_TIMEOUT_MESSAGE)), true);
});

test("isTransientDbError matches the node-postgres connect timeout", () => {
  assert.equal(isTransientDbError(new Error(CONNECT_TIMEOUT_MESSAGE)), true);
});

test("isTransientDbError reads a plain-object cause", () => {
  const outer = Object.assign(new Error("Invalid `db.product.findMany()` invocation"), {
    cause: { message: SUPAVISOR_AUTH_TIMEOUT_MESSAGE },
  });
  assert.equal(isTransientDbError(outer), true);
});

test("isTransientDbError ignores a genuine query error", () => {
  assert.equal(isTransientDbError(new Error("Unique constraint failed on the fields: (`code`)")), false);
  assert.equal(isTransientDbError(undefined), false);
  assert.equal(isTransientDbError({ nested: { message: CONNECT_TIMEOUT_MESSAGE } }), false);
});

test("withDbRetry retries the Supavisor auth timeout and returns the eventual result", async () => {
  let attempts = 0;
  const result = await withDbRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw makeDriverAdapterError(SUPAVISOR_AUTH_TIMEOUT_MESSAGE);
    return "ok";
  });

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
});

test("withDbRetry gives up after the configured retries and rethrows the last error", async () => {
  let attempts = 0;
  await assert.rejects(
    withDbRetry(async () => {
      attempts += 1;
      throw makeDriverAdapterError(SUPAVISOR_AUTH_TIMEOUT_MESSAGE);
    }),
    /EAUTHTIMEOUT/,
  );

  // 1 initial attempt + DEFAULT_DB_RETRIES (2).
  assert.equal(attempts, 3);
});

test("withDbRetry does not retry a non-transient error", async () => {
  let attempts = 0;
  await assert.rejects(
    withDbRetry(async () => {
      attempts += 1;
      throw new Error("Unique constraint failed on the fields: (`code`)");
    }),
    /Unique constraint/,
  );

  assert.equal(attempts, 1);
});

test("withDbRetry allows only one retry for a pool-acquire timeout", async () => {
  let attempts = 0;
  await assert.rejects(
    withDbRetry(async () => {
      attempts += 1;
      throw new Error("timeout exceeded when trying to connect");
    }),
    /timeout exceeded/,
  );

  assert.equal(attempts, 2);
});

const DB_RETRY_LOG_PREFIX = "[db-retry] ";

const readDbRetryLines = (calls: ReadonlyArray<{ arguments: unknown[] }>) =>
  calls.map((call) => {
    const line = String(call.arguments[0]);
    assert.ok(line.startsWith(DB_RETRY_LOG_PREFIX), line);
    return JSON.parse(line.slice(DB_RETRY_LOG_PREFIX.length)) as Record<string, unknown>;
  });

test("withDbRetry logs a timing line per transient failure and one on recovery", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  let attempts = 0;
  const result = await withDbRetry(async () => {
    attempts += 1;
    if (attempts === 1) {
      // Prisma wraps the pg-pool message; only the matched phrase may be logged.
      throw Object.assign(new Error("Invalid `db.product.findMany()` invocation: secret-arg"), {
        cause: { message: "timeout exceeded when trying to connect" },
      });
    }
    return "ok";
  });

  assert.equal(result, "ok");
  const [failure, recovery] = readDbRetryLines(warn.mock.calls);
  assert.equal(warn.mock.callCount(), 2);

  assert.equal(failure.outcome, "retrying");
  assert.equal(failure.kind, "pool-acquire");
  assert.equal(failure.error, "timeout exceeded when trying to connect");
  assert.equal(failure.attempt, 1);
  assert.equal(failure.maxAttempts, 2);
  assert.equal(typeof failure.waitedMs, "number");
  assert.equal(typeof failure.monoWaitedMs, "number");
  assert.ok(Number(failure.timeoutMs) >= 5_000);
  assert.equal(typeof failure.uptimeS, "number");
  assert.match(String(failure.instance), /^[a-z0-9]+$/);
  assert.ok(!Number.isNaN(Date.parse(String(failure.callStartedAt))));
  assert.doesNotMatch(JSON.stringify(failure), /secret-arg|findMany/);

  assert.equal(recovery.outcome, "recovered");
  assert.equal(recovery.attempt, 2);
  assert.equal(recovery.instance, failure.instance);
  assert.equal(recovery.callStartedAt, failure.callStartedAt);
});

test("withDbRetry logs gave-up on the last transient attempt and nothing for other errors", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});

  await assert.rejects(
    withDbRetry(async () => {
      throw new Error(CONNECT_TIMEOUT_MESSAGE);
    }, 1),
    /connection timeout/,
  );
  const lines = readDbRetryLines(warn.mock.calls);
  assert.deepEqual(
    lines.map((line) => [line.outcome, line.kind, line.attempt, line.maxAttempts]),
    [
      ["retrying", "connection", 1, 2],
      ["gave-up", "connection", 2, 2],
    ],
  );

  warn.mock.resetCalls();
  await assert.rejects(
    withDbRetry(async () => {
      throw new Error("Unique constraint failed on the fields: (`code`)");
    }),
    /Unique constraint/,
  );
  assert.equal(warn.mock.callCount(), 0);

  assert.equal(await withDbRetry(async () => "ok"), "ok");
  assert.equal(warn.mock.callCount(), 0);
});
