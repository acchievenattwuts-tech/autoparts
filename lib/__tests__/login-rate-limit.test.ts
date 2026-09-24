import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach, mock } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

/**
 * recordFailedLogin() now runs one INSERT ... ON CONFLICT DO UPDATE per key.
 * These tests execute that exact SQL against an in-process Postgres (PGlite)
 * and compare every attempt with the previous read-then-write algorithm, so a
 * user failing one attempt at a time is locked at exactly the same attempt as
 * before, while parallel failures are no longer lost.
 */

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000;
const LOCKOUT_MS = 5 * 60 * 1000;
const T0 = Date.parse("2026-09-24T03:00:00.000Z");

type ThrottleRow = { failures: number; firstFailureAt: Date | null; lockedUntil: Date | null };

let pg: PGlite;

/** Same parameter handling as @prisma/adapter-pg: Dates go out as zone-less UTC strings. */
function toAdapterParam(value: unknown): unknown {
  if (!(value instanceof Date)) return value;
  return value.toISOString().replace("T", " ").replace("Z", "");
}

const db = {
  $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    const text = strings.reduce((sql, part, index) => (index === 0 ? part : `${sql}$${index}${part}`), "");
    const result = await pg.query(text, values.map(toAdapterParam));
    return result.rows;
  },
  $transaction: async (operations: Promise<unknown>[]): Promise<unknown[]> => Promise.all(operations),
  loginThrottle: {
    findMany: async (args: { where: { key: { in: string[] } } }): Promise<{ lockedUntil: Date | null }[]> => {
      const result = await pg.query<{ lockedUntil: Date | null }>(
        `SELECT "lockedUntil" FROM "LoginThrottle" WHERE "key" = ANY($1)`,
        [args.where.key.in],
      );
      return result.rows;
    },
    deleteMany: async (args: { where: { key: { in: string[] } } }): Promise<{ count: number }> => {
      const result = await pg.query(`DELETE FROM "LoginThrottle" WHERE "key" = ANY($1)`, [args.where.key.in]);
      return { count: result.affectedRows ?? 0 };
    },
  },
};

before(async () => {
  if (moduleMocksUnavailable) return;
  pg = new PGlite();
  await pg.exec(`
    SET TIME ZONE 'UTC';
    CREATE TABLE "LoginThrottle" (
      "key" TEXT PRIMARY KEY,
      "failures" INTEGER NOT NULL DEFAULT 0,
      "firstFailureAt" TIMESTAMPTZ(3),
      "lockedUntil" TIMESTAMPTZ(3),
      "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMPTZ(3) NOT NULL
    );
  `);
  await mock.module("@/lib/db", { namedExports: { db } });
});

after(async () => {
  await pg?.close();
});

beforeEach(async () => {
  if (moduleMocksUnavailable) return;
  await pg.exec(`DELETE FROM "LoginThrottle"`);
  mock.timers.enable({ apis: ["Date"], now: T0 });
});

afterEach(() => {
  mock.timers.reset();
});

const at = (offsetMs: number): void => mock.timers.setTime(T0 + offsetMs);

async function readRow(key: string): Promise<ThrottleRow | null> {
  const result = await pg.query<ThrottleRow>(
    `SELECT "failures", "firstFailureAt", "lockedUntil" FROM "LoginThrottle" WHERE "key" = $1`,
    [key],
  );
  return result.rows[0] ?? null;
}

/** The previous read-then-write rule, kept verbatim as the reference model. */
function referenceRecord(current: ThrottleRow | undefined, now: Date): ThrottleRow {
  if (!current) return { failures: 1, firstFailureAt: now, lockedUntil: null };
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const withinWindow = current.firstFailureAt !== null && current.firstFailureAt >= windowStart;
  const failures = withinWindow ? current.failures + 1 : 1;
  return {
    failures,
    firstFailureAt: withinWindow ? current.firstFailureAt : now,
    lockedUntil: failures >= MAX_ATTEMPTS ? new Date(now.getTime() + LOCKOUT_MS) : null,
  };
}

/** Mirrors auth.ts: a blocked attempt is refused before anything is recorded. */
async function attemptWrongPassword(keys: string[]): Promise<"refused" | "counted"> {
  const { isLoginBlocked, recordFailedLogin } = await import("@/lib/login-rate-limit");
  if (await isLoginBlocked(keys)) return "refused";
  await recordFailedLogin(keys);
  return "counted";
}

test("one-at-a-time failures: attempts 1-5 are checked, the 6th is refused, same as before", { skip: moduleMocksUnavailable }, async () => {
  const keys = ["username:somchai", "ip:203.0.113.7"];
  const outcomes: string[] = [];
  for (let attempt = 0; attempt < 7; attempt += 1) {
    at(attempt * 10_000);
    outcomes.push(await attemptWrongPassword(keys));
  }
  assert.deepEqual(outcomes, ["counted", "counted", "counted", "counted", "counted", "refused", "refused"]);

  const row = await readRow("username:somchai");
  assert.equal(row?.failures, MAX_ATTEMPTS);
  assert.equal(row?.lockedUntil?.getTime(), T0 + 4 * 10_000 + LOCKOUT_MS);
});

test("the lock lasts LOCKOUT_MS, then counting restarts at 1", { skip: moduleMocksUnavailable }, async () => {
  const keys = ["username:somchai"];
  const lastFailure = (MAX_ATTEMPTS - 1) * 10_000;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    at(attempt * 10_000);
    await attemptWrongPassword(keys);
  }

  at(lastFailure + LOCKOUT_MS - 1);
  assert.equal(await attemptWrongPassword(keys), "refused");
  at(lastFailure + LOCKOUT_MS);
  assert.equal(await attemptWrongPassword(keys), "counted");
  assert.deepEqual(await readRow("username:somchai"), {
    failures: 1,
    firstFailureAt: new Date(T0 + lastFailure + LOCKOUT_MS),
    lockedUntil: null,
  });
});

test("every write matches the previous algorithm across window edges and lock expiry", { skip: moduleMocksUnavailable }, async () => {
  const { recordFailedLogin } = await import("@/lib/login-rate-limit");
  const key = "username:somchai";
  // Offsets chosen to hit: inside the window, exactly on the window boundary,
  // just past it, a fresh lock, and a failure recorded after the lock expired.
  const offsets = [0, 60_000, WINDOW_MS, WINDOW_MS + 1, WINDOW_MS + 2, WINDOW_MS + 3, WINDOW_MS + 4, WINDOW_MS + 5, 3 * WINDOW_MS];
  let expected: ThrottleRow | undefined;

  for (const offset of offsets) {
    at(offset);
    expected = referenceRecord(expected, new Date(T0 + offset));
    await recordFailedLogin([key]);
    assert.deepEqual(await readRow(key), expected, `after failure at +${offset}ms`);
  }
});

test("the username key and the IP key are counted independently, as before", { skip: moduleMocksUnavailable }, async () => {
  for (let index = 0; index < MAX_ATTEMPTS; index += 1) {
    await attemptWrongPassword([`username:user${index}`, "ip:198.51.100.1"]);
  }
  assert.equal((await readRow("ip:198.51.100.1"))?.failures, MAX_ATTEMPTS);
  assert.equal((await readRow("username:user0"))?.failures, 1);
  assert.equal(await attemptWrongPassword(["username:someone-else", "ip:198.51.100.1"]), "refused");
  assert.equal(await attemptWrongPassword(["username:user0", "ip:198.51.100.2"]), "counted");
});

test("a successful login still clears both keys", { skip: moduleMocksUnavailable }, async () => {
  const { clearFailedLogins } = await import("@/lib/login-rate-limit");
  const keys = ["username:somchai", "ip:203.0.113.7"];
  for (let attempt = 0; attempt < 3; attempt += 1) await attemptWrongPassword(keys);
  await clearFailedLogins(keys);
  assert.equal(await readRow("username:somchai"), null);
  assert.equal(await readRow("ip:203.0.113.7"), null);
});

test("parallel failures are all counted and never collide on the first insert", { skip: moduleMocksUnavailable }, async () => {
  const { recordFailedLogin } = await import("@/lib/login-rate-limit");
  const keys = ["username:somchai", "ip:203.0.113.7"];
  await Promise.all(Array.from({ length: 12 }, () => recordFailedLogin(keys)));

  const row = await readRow("username:somchai");
  assert.equal(row?.failures, 12);
  assert.equal(row?.lockedUntil?.getTime(), T0 + LOCKOUT_MS);
  assert.equal((await readRow("ip:203.0.113.7"))?.failures, 12);
});
