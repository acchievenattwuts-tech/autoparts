import test from "node:test";
import assert from "node:assert/strict";

import { shouldRejectRootPost } from "@/lib/root-request-guard";

test("rejects only POST requests to the exact root path", () => {
  assert.equal(shouldRejectRootPost("/", "POST"), true);
  assert.equal(shouldRejectRootPost("/", "post"), true);
});

test("keeps GET, HEAD, and other root methods on the existing request path", () => {
  assert.equal(shouldRejectRootPost("/", "GET"), false);
  assert.equal(shouldRejectRootPost("/", "HEAD"), false);
  assert.equal(shouldRejectRootPost("/", "OPTIONS"), false);
});

test("never blocks POST requests for application routes outside the root", () => {
  assert.equal(shouldRejectRootPost("/products", "POST"), false);
  assert.equal(shouldRejectRootPost("/api/auth/callback/credentials", "POST"), false);
  assert.equal(shouldRejectRootPost("/api/line/webhook", "POST"), false);
  assert.equal(shouldRejectRootPost("/admin/products", "POST"), false);
});
