import type { SignInResponse } from "next-auth/react";

export type SignInOutcome = "success" | "invalid-credentials" | "unavailable";

/**
 * next-auth's client signIn({ redirect: false }) reports a wrong password as
 * `{ ok: true, error: "CredentialsSignin" }`, resolves `undefined` when the auth
 * providers cannot be loaded, and can answer `ok: false` on a server error.
 * Only a response that is ok and error-free is a successful login.
 */
export const classifySignInResult = (result: SignInResponse | undefined): SignInOutcome => {
  if (result?.error) return "invalid-credentials";
  if (!result?.ok) return "unavailable";
  return "success";
};
