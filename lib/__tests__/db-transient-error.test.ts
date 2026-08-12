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
