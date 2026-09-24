import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import {
  clearRevocationCache,
  isSessionRevoked,
  REVOCATION_CACHE_TTL_MS,
  type UserAuthState,
} from "@/lib/auth-revocation-cache";

const T0 = 1_000_000;
let row: UserAuthState | null;
let loads = 0;
const load = async (): Promise<UserAuthState | null> => {
  loads += 1;
  return row;
};
const check = (tokenVersion: unknown, now: number): Promise<boolean> =>
  isSessionRevoked({ userId: "u1", tokenVersion, load, now });

beforeEach(() => {
  clearRevocationCache();
  row = { authVersion: 3, isActive: true };
  loads = 0;
});

test("the TTL is at most 30 seconds", () => {
  assert.ok(REVOCATION_CACHE_TTL_MS <= 30_000);
});

test("a valid session is looked up once per TTL window", async () => {
  assert.equal(await check(3, T0), false);
  assert.equal(await check(3, T0 + REVOCATION_CACHE_TTL_MS - 1), false);
  assert.equal(loads, 1);
  assert.equal(await check(3, T0 + REVOCATION_CACHE_TTL_MS), false);
  assert.equal(loads, 2);
});

test("a disabled user is rejected no later than the TTL", async () => {
  await check(3, T0);
  row = { authVersion: 3, isActive: false };
  assert.equal(await check(3, T0 + REVOCATION_CACHE_TTL_MS), true);
});

test("a bumped authVersion rejects the old token no later than the TTL", async () => {
  await check(3, T0);
  row = { authVersion: 4, isActive: true };
  assert.equal(await check(3, T0 + REVOCATION_CACHE_TTL_MS), true);
});

test("a stale cache never rejects a token the database accepts (new token after a password change)", async () => {
  await check(3, T0);
  row = { authVersion: 4, isActive: true };
  // Fresh login carries version 4 while the cache still says 3: re-read, accept.
  assert.equal(await check(4, T0 + 1), false);
  assert.equal(loads, 2);
});

test("a re-enabled user is accepted immediately, and a rejection is never cached", async () => {
  row = { authVersion: 3, isActive: false };
  assert.equal(await check(3, T0), true);
  row = { authVersion: 3, isActive: true };
  assert.equal(await check(3, T0 + 1), false);
  assert.equal(loads, 2);
});

test("a deleted user and a token without a version are rejected", async () => {
  row = null;
  assert.equal(await check(3, T0), true);
  row = { authVersion: 3, isActive: true };
  assert.equal(await check(undefined, T0 + 1), true);
});

test("lookup errors propagate so auth.config.ts can fail closed", async () => {
  await assert.rejects(
    isSessionRevoked({ userId: "u2", tokenVersion: 1, now: T0, load: async () => Promise.reject(new Error("DB_DOWN")) }),
    /DB_DOWN/,
  );
});
