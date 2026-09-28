import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import type { NextAuthConfig, Session } from "next-auth";
import type { JWT } from "next-auth/jwt";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

/**
 * The jwt() callback in auth.config.ts must stay fail-closed (sessionInvalid)
 * when the revocation lookup throws, and additionally flag sessionCheckFailed
 * so the idle-tab watcher does not throw everyone out on a DB blip. A real
 * authVersion bump must still read as a revocation. Only the database is faked.
 */

type FakeUser = { authVersion: number; isActive: boolean };
let row: FakeUser | null;
let lookupError: Error | null;

type Callbacks = NonNullable<NextAuthConfig["callbacks"]>;
type JwtParams = Parameters<NonNullable<Callbacks["jwt"]>>[0];
type SessionParams = Parameters<NonNullable<Callbacks["session"]>>[0];

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        user: {
          findUnique: async (): Promise<FakeUser | null> => {
            if (lookupError) throw lookupError;
            return row;
          },
        },
      },
      withDbRetry: async <T>(operation: () => Promise<T>): Promise<T> => operation(),
      isTransientDbError: () => false,
      dbTx: () => {
        throw new Error("not used");
      },
      dbSearchRaw: async () => {
        throw new Error("not used");
      },
      dbSearchTx: async () => {
        throw new Error("not used");
      },
    },
  });
});

beforeEach(async () => {
  if (moduleMocksUnavailable) return;
  const { clearRevocationCache } = await import("@/lib/auth-revocation-cache");
  clearRevocationCache();
  row = { authVersion: 3, isActive: true };
  lookupError = null;
});

/** Runs jwt() then session() the way Auth.js does for an existing cookie. */
const resolveSession = async (token: JWT): Promise<{ token: JWT; session: Session }> => {
  const { authConfig } = await import("@/auth.config");
  const callbacks = authConfig.callbacks as Callbacks;
  // Auth.js passes no `user` after sign-in; the callback types do not model that.
  const nextToken = (await callbacks.jwt!({ token, account: null } as unknown as JwtParams)) as JWT;
  const base: Session = {
    expires: "2099-01-01T00:00:00.000Z",
    user: { id: "", role: "", permissions: [], mustChangePassword: false, sessionInvalid: false },
  };
  const session = (await callbacks.session!({ session: base, token: nextToken } as unknown as SessionParams)) as Session;
  return { token: nextToken, session };
};

const existingToken = (authVersion: number): JWT => ({
  id: "u1",
  role: "STAFF",
  permissions: [],
  authVersion,
  sessionInvalid: false,
});

test("a valid token is active and not flagged", { skip: moduleMocksUnavailable }, async () => {
  const { session } = await resolveSession(existingToken(3));
  assert.equal(session.user.sessionInvalid, false);
  assert.equal(session.user.sessionCheckFailed, false);
});

test("a bumped authVersion is a revocation, not a failed check", { skip: moduleMocksUnavailable }, async () => {
  row = { authVersion: 4, isActive: true };
  const { session } = await resolveSession(existingToken(3));
  assert.equal(session.user.sessionInvalid, true);
  assert.equal(session.user.sessionCheckFailed, false);
});

test("a failed lookup stays fail-closed but is flagged as unverified", { skip: moduleMocksUnavailable }, async () => {
  lookupError = new Error("connection timeout");
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const { token, session } = await resolveSession(existingToken(3));
    assert.equal(session.user.sessionInvalid, true, "every route gate must still reject it");
    assert.equal(session.user.sessionCheckFailed, true);

    // Once the database answers again the flag clears on the next call.
    lookupError = null;
    const recovered = await resolveSession(token);
    assert.equal(recovered.session.user.sessionInvalid, false);
    assert.equal(recovered.session.user.sessionCheckFailed, false);
  } finally {
    console.error = originalConsoleError;
  }
});
