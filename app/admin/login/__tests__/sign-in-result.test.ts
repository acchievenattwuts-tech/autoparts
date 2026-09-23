import assert from "node:assert/strict";
import test from "node:test";

import { classifySignInResult } from "../sign-in-result";

const response = (overrides: Partial<{ error: string; ok: boolean; status: number }>) => ({
  error: undefined,
  code: undefined,
  status: 200,
  ok: true,
  url: "https://shop.test/admin",
  ...overrides,
});

test("only an ok, error-free response counts as a successful login", () => {
  assert.equal(classifySignInResult(response({})), "success");
});

test("a wrong password stays a credentials failure (lockout counter applies)", () => {
  assert.equal(classifySignInResult(response({ error: "CredentialsSignin" })), "invalid-credentials");
  assert.equal(classifySignInResult(response({ error: "CredentialsSignin", ok: false, status: 401 })), "invalid-credentials");
});

test("providers unavailable (undefined) or a server error is not treated as logged in", () => {
  assert.equal(classifySignInResult(undefined), "unavailable");
  assert.equal(classifySignInResult(response({ ok: false, status: 502 })), "unavailable");
});
