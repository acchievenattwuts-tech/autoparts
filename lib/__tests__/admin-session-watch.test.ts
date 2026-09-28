import assert from "node:assert/strict";
import test from "node:test";
import type { Session } from "next-auth";

import { ADMIN_LOGIN_PATH } from "@/lib/admin-route-access";
import {
  ADMIN_SESSION_CHECK_INTERVAL_MS,
  ADMIN_SESSION_END_MESSAGES,
  ADMIN_SESSION_EVENT_CHECK_MIN_GAP_MS,
  ADMIN_SESSION_WATCH_LOGIN_PATH,
  buildAdminSessionEndLoginPath,
  classifyAdminSession,
  getAdminSessionEndMessage,
  resolveAdminSessionEndReason,
  shouldCheckAdminSessionOnEvent,
} from "@/lib/admin-session-watch";

// An open admin tab must leave for the login page once its session ends on
// another device — and must NOT leave for anything that is not a real sign-out
// (network drop, 5xx, a revocation lookup that could not run).

const session = (user: Partial<Session["user"]>): Session => ({
  expires: "2099-01-01T00:00:00.000Z",
  user: { id: "u1", role: "STAFF", permissions: [], mustChangePassword: false, sessionInvalid: false, ...user },
});

test("the watcher redirects to the same login path the route gate uses", () => {
  assert.equal(ADMIN_SESSION_WATCH_LOGIN_PATH, ADMIN_LOGIN_PATH);
  assert.equal(buildAdminSessionEndLoginPath("revoked"), "/admin/login?reason=revoked");
  assert.equal(buildAdminSessionEndLoginPath("expired"), "/admin/login?reason=expired");
});

test("a visible tab is checked at least every 30 seconds", () => {
  assert.ok(ADMIN_SESSION_CHECK_INTERVAL_MS <= 30_000);
  assert.ok(ADMIN_SESSION_EVENT_CHECK_MIN_GAP_MS < ADMIN_SESSION_CHECK_INTERVAL_MS);
});

test("server: a missing, revoked, unverifiable or valid session is told apart", () => {
  assert.equal(classifyAdminSession(null), "expired");
  assert.equal(classifyAdminSession(session({ sessionInvalid: true })), "revoked");
  // The jwt() callback fails closed (sessionInvalid) when the lookup throws;
  // the watcher must not read that as a password change.
  assert.equal(classifyAdminSession(session({ sessionInvalid: true, sessionCheckFailed: true })), "unverified");
  assert.equal(classifyAdminSession(session({})), "active");
});

test("client: only a 401 ends the session", () => {
  assert.equal(resolveAdminSessionEndReason(401, { ok: false, reason: "revoked" }), "revoked");
  assert.equal(resolveAdminSessionEndReason(401, { ok: false, reason: "expired" }), "expired");
  // A 401 without a readable reason is still a signed-out session.
  assert.equal(resolveAdminSessionEndReason(401, null), "expired");
  assert.equal(resolveAdminSessionEndReason(401, { reason: "something-else" }), "expired");

  assert.equal(resolveAdminSessionEndReason(200, { ok: true }), null);
  assert.equal(resolveAdminSessionEndReason(503, { ok: false, error: "SESSION_CHECK_UNAVAILABLE" }), null);
  assert.equal(resolveAdminSessionEndReason(500, { ok: false, error: "INTERNAL_ERROR" }), null);
  assert.equal(resolveAdminSessionEndReason(403, { ok: false, reason: "revoked" }), null);
});

test("focus and visibility events share one check within the minimum gap", () => {
  const lastCheckedAt = 1_000_000;
  assert.equal(shouldCheckAdminSessionOnEvent({ now: lastCheckedAt + 100, lastCheckedAt }), false);
  assert.equal(
    shouldCheckAdminSessionOnEvent({ now: lastCheckedAt + ADMIN_SESSION_EVENT_CHECK_MIN_GAP_MS, lastCheckedAt }),
    true,
  );
});

test("the login page explains only the reasons the watcher sends", () => {
  assert.equal(getAdminSessionEndMessage("revoked"), ADMIN_SESSION_END_MESSAGES.revoked);
  assert.equal(getAdminSessionEndMessage("expired"), ADMIN_SESSION_END_MESSAGES.expired);
  assert.equal(getAdminSessionEndMessage(["revoked", "expired"]), ADMIN_SESSION_END_MESSAGES.revoked);
  assert.equal(getAdminSessionEndMessage(undefined), null);
  assert.equal(getAdminSessionEndMessage("<script>"), null);
  assert.match(ADMIN_SESSION_END_MESSAGES.revoked, /เปลี่ยนรหัสผ่าน/);
});
