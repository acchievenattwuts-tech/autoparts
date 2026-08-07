import test from "node:test";
import assert from "node:assert/strict";

import { checkEnv, type EnvSnapshot } from "@/lib/env";

// Golden suite for the startup environment check. The classification matters
// more than the wording: promoting a warning to an error turns a degraded
// integration into a failed deployment, so each case below states which side of
// that line a variable sits on.

const fullEnv = (): EnvSnapshot => ({
  DATABASE_URL: "postgresql://user:pass@host:5432/db",
  NEXTAUTH_SECRET: "secret",
  CRON_SECRET: "secret",
  REVALIDATE_SECRET: "secret",
  DOC_VERIFY_SECRET: "secret",
  LINE_MESSAGING_API_CHANNEL_SECRET: "secret",
  MESSENGER_APP_SECRET: "secret",
});

test("a fully configured environment reports nothing", () => {
  const result = checkEnv(fullEnv());
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test("a missing DATABASE_URL is fatal", () => {
  const env = fullEnv();
  delete env.DATABASE_URL;
  assert.equal(checkEnv(env).errors.length, 1);
});

// The whole reason this check exists: unset CRON_SECRET makes every scheduled
// job answer 401 forever, with nothing in the logs to say so.
test("a missing CRON_SECRET warns and names what stops running", () => {
  const env = fullEnv();
  delete env.CRON_SECRET;
  const { errors, warnings } = checkEnv(env);
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.key, "CRON_SECRET");
  assert.match(warnings[0]?.consequence ?? "", /401/);
});

// NextAuth v5 renamed the variable; either spelling must satisfy the check, or
// a correctly configured v5 deployment would warn on every boot.
test("AUTH_SECRET satisfies the NEXTAUTH_SECRET requirement", () => {
  const env = fullEnv();
  delete env.NEXTAUTH_SECRET;
  env.AUTH_SECRET = "secret";
  assert.deepEqual(checkEnv(env).warnings, []);
});

test("neither secret set warns about signing sessions", () => {
  const env = fullEnv();
  delete env.NEXTAUTH_SECRET;
  const { warnings } = checkEnv(env);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.key, "NEXTAUTH_SECRET");
});

// A variable present but blank is the same as absent — Vercel keeps empty
// values for cleared secrets, so a whitespace check would otherwise pass.
test("a blank value counts as missing", () => {
  const env = fullEnv();
  env.CRON_SECRET = "   ";
  assert.equal(checkEnv(env).warnings.some((w) => w.key === "CRON_SECRET"), true);
});

// Feature-gated integrations must never be fatal: a shop with no Telegram or
// Shopee configured has to keep deploying.
test("unconfigured optional integrations are neither errors nor warnings", () => {
  const env = fullEnv();
  const { errors, warnings } = checkEnv(env);
  assert.deepEqual(errors, []);
  const flagged = warnings.map((w) => w.key);
  for (const optional of [
    "TELEGRAM_BOT_TOKEN",
    "SHOPEE_PARTNER_KEY",
    "OPENAI_API_KEY",
    "QSTASH_TOKEN",
    "NEXT_PUBLIC_GA_ID",
  ]) {
    assert.equal(flagged.includes(optional), false, `${optional} must stay optional`);
  }
});

test("several missing secrets are all reported, not just the first", () => {
  const env = fullEnv();
  delete env.CRON_SECRET;
  delete env.DOC_VERIFY_SECRET;
  delete env.MESSENGER_APP_SECRET;
  assert.equal(checkEnv(env).warnings.length, 3);
});
