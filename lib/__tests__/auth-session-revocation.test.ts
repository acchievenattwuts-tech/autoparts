import assert from "node:assert/strict";
import test from "node:test";

import { isSessionRevisionInvalid } from "@/lib/auth-session-revocation";

test("session revision remains valid only for an active user with the same version", () => {
  assert.equal(isSessionRevisionInvalid({ tokenVersion: 3, currentVersion: 3, isActive: true }), false);
  assert.equal(isSessionRevisionInvalid({ tokenVersion: 2, currentVersion: 3, isActive: true }), true);
  assert.equal(isSessionRevisionInvalid({ tokenVersion: 3, currentVersion: 3, isActive: false }), true);
  assert.equal(isSessionRevisionInvalid({ tokenVersion: undefined, currentVersion: 0, isActive: true }), true);
  assert.equal(isSessionRevisionInvalid({ tokenVersion: 0, currentVersion: null, isActive: true }), true);
});
