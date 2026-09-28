import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// /api/admin is outside the proxy matcher, so the route is its own gate. It is
// polled by every open admin tab: 401 sends the tab to the login page, so it
// must only ever answer 401 for a session that really ended.

type FakeSession = {
  expires: string;
  user: { id: string; sessionInvalid: boolean; sessionCheckFailed?: boolean };
} | null;

let session: FakeSession;
let sessionError: Error | null;

before(async () => {
  await mock.module("@/lib/auth-session", {
    namedExports: {
      getSession: async () => {
        if (sessionError) throw sessionError;
        return session;
      },
    },
  });
});

beforeEach(() => {
  session = { expires: "2099-01-01T00:00:00.000Z", user: { id: "u1", sessionInvalid: false } };
  sessionError = null;
});

const get = async () => {
  const { GET } = await import("../route");
  const response = await GET();
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control"),
    body: (await response.json()) as Record<string, unknown>,
  };
};

test("a valid session answers 200 and is never cached", async () => {
  assert.deepEqual(await get(), { status: 200, cacheControl: "private, no-store", body: { ok: true } });
});

test("a revoked session answers 401 revoked", async () => {
  session = { expires: "2099-01-01T00:00:00.000Z", user: { id: "u1", sessionInvalid: true } };
  const response = await get();
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { ok: false, reason: "revoked" });
});

test("no session answers 401 expired", async () => {
  session = null;
  const response = await get();
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { ok: false, reason: "expired" });
});

test("a revocation lookup that could not run is 503, not 401", async () => {
  session = {
    expires: "2099-01-01T00:00:00.000Z",
    user: { id: "u1", sessionInvalid: true, sessionCheckFailed: true },
  };
  const response = await get();
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { ok: false, error: "SESSION_CHECK_UNAVAILABLE" });
});

test("an unexpected failure is 500 with a generic body", async () => {
  sessionError = new Error("boom");
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const response = await get();
    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { ok: false, error: "INTERNAL_ERROR" });
  } finally {
    console.error = originalConsoleError;
  }
});
