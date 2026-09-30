import assert from "node:assert/strict";
import test, { afterEach, before, beforeEach, mock } from "node:test";
import { attachDatabasePool as realAttachDatabasePool } from "@vercel/functions";

// The real helper runs in every test except where `attachError` is set, which
// simulates a future pg / @vercel/functions upgrade rejecting Prisma's pool.
let attachError: Error | null = null;
let FluidPrismaPg: typeof import("../db-pool").FluidPrismaPg;

before(async () => {
  mock.module("@vercel/functions", {
    namedExports: {
      attachDatabasePool: (...args: Parameters<typeof realAttachDatabasePool>): void => {
        if (attachError) throw attachError;
        realAttachDatabasePool(...args);
      },
    },
  });
  ({ FluidPrismaPg } = await import("../db-pool"));
});

const POOL_CONFIG = {
  connectionString: "postgresql://test:test@127.0.0.1:1/unused",
  max: 8,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 20_000,
};

const VERCEL_ENV_KEYS = ["VERCEL", "VERCEL_URL", "VERCEL_REGION"] as const;
let originalEnv: Array<string | undefined>;
beforeEach(() => { originalEnv = VERCEL_ENV_KEYS.map((key) => process.env[key]); });
afterEach(() => {
  attachError = null;
  VERCEL_ENV_KEYS.forEach((key, index) => {
    const value = originalEnv[index];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

test("Fluid lifecycle uses Prisma's pool without opening a database connection", async () => {
  process.env.VERCEL = "1";
  const factory = new FluidPrismaPg(POOL_CONFIG);
  const adapter = await factory.connect();
  const pool = adapter.underlyingDriver();
  try {
    assert.equal(pool.listenerCount("release"), 1);
    assert.equal(pool.totalCount, 0);
    assert.equal(pool.options.max, POOL_CONFIG.max);
    assert.equal(pool.options.idleTimeoutMillis, POOL_CONFIG.idleTimeoutMillis);
    assert.equal(pool.options.connectionTimeoutMillis, POOL_CONFIG.connectionTimeoutMillis);
  } finally {
    await adapter.dispose();
  }
  assert.equal(pool.ended, true);
});

test("local runtime keeps Prisma's normal pool lifecycle", async () => {
  process.env.VERCEL = "";
  const adapter = await new FluidPrismaPg(POOL_CONFIG).connect();
  try {
    assert.equal(adapter.underlyingDriver().listenerCount("release"), 0);
    assert.equal(adapter.underlyingDriver().totalCount, 0);
  } finally {
    await adapter.dispose();
  }
});

test("reconnecting registers each new pool once and disposes the previous pool", async () => {
  process.env.VERCEL = "1";
  const factory = new FluidPrismaPg(POOL_CONFIG);
  const first = await factory.connect();
  const firstPool = first.underlyingDriver();
  await first.dispose();
  const second = await factory.connect();
  try {
    const secondPool = second.underlyingDriver();
    assert.notEqual(secondPool, firstPool);
    assert.equal(firstPool.ended, true);
    assert.equal(secondPool.listenerCount("release"), 1);
    assert.equal(secondPool.totalCount, 0);
  } finally {
    await second.dispose();
  }
});

test("releasing a pool client registers an idle wait with the Vercel request context", async (t) => {
  process.env.VERCEL = "1";
  process.env.VERCEL_URL = "unit-test.vercel.app";
  process.env.VERCEL_REGION = "sin1";
  const contextKey = Symbol.for("@vercel/request-context");
  const originalContext = Object.getOwnPropertyDescriptor(globalThis, contextKey);
  const backgroundWork: Promise<unknown>[] = [];
  Object.defineProperty(globalThis, contextKey, {
    configurable: true,
    value: { get: () => ({ waitUntil: (promise: Promise<unknown>) => backgroundWork.push(promise) }) },
  });
  t.after(() => {
    if (originalContext) Object.defineProperty(globalThis, contextKey, originalContext);
    else Reflect.deleteProperty(globalThis, contextKey);
  });
  const adapter = await new FluidPrismaPg({ ...POOL_CONFIG, idleTimeoutMillis: 1 }).connect();
  try {
    const pool = adapter.underlyingDriver();
    // Exercise the real helper's release listener without opening a DB socket.
    pool.emit("release");
    assert.equal(backgroundWork.length, 1);
    await backgroundWork[0];
    assert.equal(pool.totalCount, 0);
  } finally {
    await adapter.dispose();
  }
});

test("a failing Fluid registration keeps the adapter and its pool usable", async (t) => {
  process.env.VERCEL = "1";
  attachError = new Error("Unsupported database pool type");
  const warn = t.mock.method(console, "warn", () => undefined);
  const factory = new FluidPrismaPg(POOL_CONFIG);
  const adapter = await factory.connect();
  const pool = adapter.underlyingDriver();
  const reconnected = await factory.connect();
  try {
    assert.equal(pool.ended, false);
    assert.equal(pool.listenerCount("release"), 0);
    assert.equal(pool.options.max, POOL_CONFIG.max);
    assert.equal(reconnected.underlyingDriver().ended, false);
    // Warned once for the process, and the message never carries the DSN.
    assert.equal(warn.mock.callCount(), 1);
    const message = String(warn.mock.calls[0]?.arguments[0]);
    assert.match(message, /Unsupported database pool type/);
    assert.doesNotMatch(message, /postgresql:|test:test/);
  } finally {
    await reconnected.dispose();
    await adapter.dispose();
  }
  assert.equal(pool.ended, true);
});
