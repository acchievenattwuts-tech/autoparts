import assert from "node:assert/strict";
import test, { before, beforeEach } from "node:test";

// #42 — dbTx must pass an explicit maxWait so a write does not fail with P2028
// after Prisma's 2s default while the pool is momentarily saturated.

type TransactionOptions = { maxWait?: number; timeout?: number; isolationLevel?: string };

let capturedOptions: TransactionOptions | undefined;

// lib/db.ts reuses `globalThis.prisma` when it is already set, so seeding it
// before the (dynamic) import swaps in a fake client without touching Postgres.
const fakeClient = {
  $transaction: async (fn: (tx: unknown) => Promise<unknown>, options?: TransactionOptions) => {
    capturedOptions = options;
    return fn({ $executeRaw: async () => 0 });
  },
};

let dbTx: typeof import("../db").dbTx;

before(async () => {
  (globalThis as { prisma?: unknown }).prisma = fakeClient;
  ({ dbTx } = await import("../db"));
});

beforeEach(() => {
  capturedOptions = undefined;
});

test("dbTx passes a 10s maxWait and the 110s timeout by default", async () => {
  const result = await dbTx(async () => "ok");
  assert.equal(result, "ok");
  assert.equal(capturedOptions?.maxWait, 10_000);
  assert.equal(capturedOptions?.timeout, 110_000);
  assert.equal(capturedOptions?.isolationLevel, undefined);
});

test("dbTx keeps the default maxWait when only a custom timeout is given", async () => {
  await dbTx(async () => undefined, { timeout: 180_000 });
  assert.equal(capturedOptions?.maxWait, 10_000);
  assert.equal(capturedOptions?.timeout, 180_000);
});

test("dbTx lets a caller override maxWait", async () => {
  await dbTx(async () => undefined, { maxWait: 3_000 });
  assert.equal(capturedOptions?.maxWait, 3_000);
  assert.equal(capturedOptions?.timeout, 110_000);
});
