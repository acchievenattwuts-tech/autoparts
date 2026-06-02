import test from "node:test";
import assert from "node:assert/strict";

import { isLockHeld } from "../sync-lock";

const NOW = 1_700_000_000_000;
const STALE_MS = 10 * 60 * 1000;

test("no running job → lock is free", () => {
  assert.equal(isLockHeld(null, NOW, STALE_MS), false);
  assert.equal(isLockHeld(undefined, NOW, STALE_MS), false);
});

test("recent running job → lock held", () => {
  const startedAt = new Date(NOW - 60_000); // 1 min ago
  assert.equal(isLockHeld(startedAt, NOW, STALE_MS), true);
});

test("stale running job (older than staleMs) → lock released", () => {
  const startedAt = new Date(NOW - (STALE_MS + 1)); // just past stale window
  assert.equal(isLockHeld(startedAt, NOW, STALE_MS), false);
});

test("exactly at stale boundary → released (not strictly less)", () => {
  const startedAt = new Date(NOW - STALE_MS);
  assert.equal(isLockHeld(startedAt, NOW, STALE_MS), false);
});

test("uses default stale window when omitted", () => {
  assert.equal(isLockHeld(new Date(NOW - 60_000), NOW), true);
  assert.equal(isLockHeld(new Date(NOW - (11 * 60 * 1000)), NOW), false);
});
