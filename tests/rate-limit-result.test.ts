import assert from "node:assert/strict";
import test from "node:test";
import { buildRateLimitResult } from "../lib/rate-limit-result";

test("buildRateLimitResult allows requests at the configured limit", () => {
  assert.deepEqual(buildRateLimitResult({ count: 3, limit: 3, resetAt: 1000 }), {
    ok: true,
    remaining: 0,
    resetAt: 1000,
  });
});

test("buildRateLimitResult rejects requests over the configured limit", () => {
  assert.deepEqual(buildRateLimitResult({ count: 4, limit: 3, resetAt: 1000 }), {
    ok: false,
    remaining: 0,
    resetAt: 1000,
  });
});
