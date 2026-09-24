import assert from "node:assert/strict";
import test from "node:test";
import { checkDestructiveDbTarget } from "@/lib/destructive-db-script-guard";

const PROD_POOLER =
  "postgresql://postgres.lueeusrezzhokfikxjgi:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true";
const PROD_DIRECT = "postgresql://postgres:secret@db.lueeusrezzhokfikxjgi.supabase.co:5432/postgres";
const OTHER_SUPABASE =
  "postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres";
const OTHER_TARGET = "postgres.abcdefghijklmnopqrst@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres";

test("refuses the production Supabase project through the pooler and the direct host", () => {
  for (const url of [PROD_POOLER, PROD_DIRECT, PROD_POOLER.toUpperCase()]) {
    const result = checkDestructiveDbTarget(url, undefined);
    assert.equal(result.allowed, false, url);
  }
});

test("the override env can never unlock production, even with the exact target string", () => {
  const override = "postgres.lueeusrezzhokfikxjgi@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres";
  assert.equal(checkDestructiveDbTarget(PROD_POOLER, override).allowed, false);
});

test("allows a database on this machine", () => {
  for (const url of [
    "postgresql://postgres:pw@localhost:5432/autoparts_test",
    "postgresql://postgres:pw@127.0.0.1:54322/postgres",
    "postgresql://postgres:pw@[::1]:5432/postgres",
  ]) {
    assert.equal(checkDestructiveDbTarget(url, undefined).allowed, true, url);
  }
});

test("refuses any other remote database unless the override names it exactly", () => {
  const refused = checkDestructiveDbTarget(OTHER_SUPABASE, undefined);
  assert.equal(refused.allowed, false);
  assert.equal(refused.target, OTHER_TARGET);
  assert.ok(!refused.target?.includes("secret"), "the target string must never contain the password");

  assert.equal(checkDestructiveDbTarget(OTHER_SUPABASE, "yes").allowed, false);
  assert.equal(checkDestructiveDbTarget(OTHER_SUPABASE, OTHER_TARGET).allowed, true);
});

test("refuses a missing or unparseable DATABASE_URL", () => {
  assert.equal(checkDestructiveDbTarget(undefined, undefined).allowed, false);
  assert.equal(checkDestructiveDbTarget("   ", undefined).allowed, false);
  assert.equal(checkDestructiveDbTarget("not a url", undefined).allowed, false);
});
