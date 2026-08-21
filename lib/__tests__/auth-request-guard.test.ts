import test from "node:test";
import assert from "node:assert/strict";

import {
  createAuthGuardResponse,
  decideAuthRequest,
} from "@/lib/auth-request-guard";

const AUTH_ACTIONS = [
  "callback",
  "csrf",
  "error",
  "providers",
  "session",
  "signin",
  "signout",
  "verify-request",
  "webauthn-options",
];

test("forwards every supported Auth.js action for GET and POST", () => {
  for (const action of AUTH_ACTIONS) {
    assert.deepEqual(decideAuthRequest(`/api/auth/${action}`, "GET"), {
      type: "forward",
    });
    assert.deepEqual(decideAuthRequest(`/api/auth/${action}`, "POST"), {
      type: "forward",
    });
  }
});

test("forwards provider subpaths only for actions that support a provider", () => {
  for (const action of ["callback", "signin", "webauthn-options"]) {
    assert.deepEqual(
      decideAuthRequest(`/api/auth/${action}/credentials`, "POST"),
      { type: "forward" },
    );
  }

  assert.deepEqual(decideAuthRequest("/api/auth/session/credentials", "GET"), {
    type: "reject",
    status: 404,
  });
});

test("rejects unknown or malformed Auth.js paths before they reach Auth.js", () => {
  for (const pathname of [
    "/api/auth/token",
    "/api/auth",
    "/api/auth/callback/credentials/extra",
    "/api/other/session",
  ]) {
    assert.deepEqual(decideAuthRequest(pathname, "POST"), {
      type: "reject",
      status: 404,
    });
  }
});

test("rejects HEAD and other unsupported methods with an Allow header decision", () => {
  for (const method of ["HEAD", "PUT", "PATCH", "DELETE"]) {
    assert.deepEqual(decideAuthRequest("/api/auth/session", method), {
      type: "reject",
      status: 405,
      allow: "GET, POST",
    });
  }
});

test("creates no-store 404 and 405 responses", async () => {
  const notFound = createAuthGuardResponse({ type: "reject", status: 404 });
  assert.equal(notFound.status, 404);
  assert.equal(notFound.headers.get("Cache-Control"), "private, no-store");
  assert.equal(await notFound.text(), "Not Found");

  const methodNotAllowed = createAuthGuardResponse({
    type: "reject",
    status: 405,
    allow: "GET, POST",
  });
  assert.equal(methodNotAllowed.status, 405);
  assert.equal(methodNotAllowed.headers.get("Allow"), "GET, POST");
  assert.equal(methodNotAllowed.headers.get("Cache-Control"), "private, no-store");
  assert.equal(await methodNotAllowed.text(), "");
});
