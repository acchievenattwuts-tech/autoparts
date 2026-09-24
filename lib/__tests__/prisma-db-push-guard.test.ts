import assert from "node:assert/strict";
import test from "node:test";
import {
  checkPrismaDbPush,
  classifyDriftStatements,
  isPrismaDbPushInvocation,
  KNOWN_SEARCH_DRIFT_STATEMENTS,
  PROD_DB_PUSH_OVERRIDE_VALUE,
  resolveDbPushTargetUrl,
  splitSqlScript,
  type DbPushGuardInput,
} from "@/lib/prisma-db-push-guard";

const PROD_POOLER =
  "postgresql://postgres.lueeusrezzhokfikxjgi:secret@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres";
const PROD_DIRECT = "postgresql://postgres:secret@db.lueeusrezzhokfikxjgi.supabase.co:5432/postgres";
const LOCAL = "postgresql://postgres:pw@localhost:5432/autoparts_test";
const OTHER_REMOTE = "postgresql://postgres.abcdefghijklmnopqrst:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres";
const OTHER_TARGET = "postgres.abcdefghijklmnopqrst@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres";

const input = (cliArgs: string[], overrides: Partial<DbPushGuardInput> = {}): DbPushGuardInput => ({
  cliArgs,
  configUrl: PROD_POOLER,
  prodOverride: undefined,
  targetOverride: undefined,
  ...overrides,
});

test("detects db push in the argv shape Prisma 7 loads the config with", () => {
  // process.argv.slice(2) for `npx prisma db push --accept-data-loss`
  assert.equal(isPrismaDbPushInvocation(["db", "push"]), true);
  assert.equal(isPrismaDbPushInvocation(["db", "push", "--accept-data-loss"]), true);
  assert.equal(isPrismaDbPushInvocation(["--config", "prisma.config.ts", "db", "push"]), true);
  assert.equal(isPrismaDbPushInvocation(["db", "push", "--schema=prisma/schema.prisma"]), true);
});

test("does not treat other Prisma commands as db push", () => {
  for (const args of [
    [],
    ["generate"],
    ["validate"],
    ["migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--script"],
    ["db", "execute", "--file", "prisma/migrations/x/migration.sql"],
    ["db", "pull"],
    ["validate", "--schema", "push"],
    ["studio"],
  ]) {
    assert.equal(isPrismaDbPushInvocation(args), false, args.join(" "));
  }
});

test("blocks db push against production through the pooler and the direct host", () => {
  for (const url of [PROD_POOLER, PROD_DIRECT]) {
    const decision = checkPrismaDbPush(input(["db", "push"], { configUrl: url }));
    assert.equal(decision.blocked, true, url);
    if (decision.blocked) {
      assert.match(decision.message, /PRODUCTION/);
      assert.match(decision.message, /prisma\/migrations/);
      assert.match(decision.message, /check-schema-drift/);
      assert.ok(!decision.message.includes("secret"), "message must never include the password");
    }
  }
});

test("a --url flag overrides the config datasource for the decision", () => {
  assert.equal(resolveDbPushTargetUrl(["db", "push", "--url", LOCAL], PROD_POOLER), LOCAL);
  assert.equal(resolveDbPushTargetUrl(["db", "push", `--url=${PROD_DIRECT}`], LOCAL), PROD_DIRECT);
  assert.equal(checkPrismaDbPush(input(["db", "push", "--url", LOCAL])).blocked, false);
  assert.equal(checkPrismaDbPush(input(["db", "push", `--url=${PROD_DIRECT}`], { configUrl: LOCAL })).blocked, true);
});

test("never blocks non-push commands, even against production", () => {
  for (const args of [["generate"], ["validate"], ["migrate", "diff", "--from-config-datasource", "--script"]]) {
    assert.equal(checkPrismaDbPush(input(args)).blocked, false, args.join(" "));
  }
});

test("allows db push --help and a local database", () => {
  assert.equal(checkPrismaDbPush(input(["db", "push", "--help"])).blocked, false);
  assert.equal(checkPrismaDbPush(input(["db", "push"], { configUrl: LOCAL })).blocked, false);
});

test("the explicit override unlocks production only with the exact value", () => {
  assert.equal(checkPrismaDbPush(input(["db", "push"], { prodOverride: PROD_DB_PUSH_OVERRIDE_VALUE })).blocked, false);
  assert.equal(checkPrismaDbPush(input(["db", "push"], { prodOverride: "true" })).blocked, true);
  assert.equal(checkPrismaDbPush(input(["db", "push"], { prodOverride: "" })).blocked, true);
});

test("other remote hosts need the per-target approval from the destructive-script guard", () => {
  assert.equal(checkPrismaDbPush(input(["db", "push"], { configUrl: OTHER_REMOTE })).blocked, true);
  assert.equal(
    checkPrismaDbPush(input(["db", "push"], { configUrl: OTHER_REMOTE, targetOverride: OTHER_TARGET })).blocked,
    false,
  );
});

test("blocks db push when no datasource URL is configured", () => {
  assert.equal(checkPrismaDbPush(input(["db", "push"], { configUrl: undefined })).blocked, true);
});

const KNOWN_DIFF = `-- DropIndex
DROP INDEX "idx_knowledge_documents_search_document";

-- DropIndex
DROP INDEX "idx_knowledge_documents_search_text_trgm";

-- DropIndex
DROP INDEX "idx_product_search_documents_keyword_trgm";

-- DropIndex
DROP INDEX "idx_product_search_documents_oem_trgm";

-- DropIndex
DROP INDEX "idx_psd_embedding_hnsw";

-- AlterTable
ALTER TABLE "product_search_documents" DROP COLUMN "trgm_text";
`;

test("the real known drift output classifies as fully expected", () => {
  const result = classifyDriftStatements(KNOWN_DIFF);
  assert.deepEqual(result.unexpected, []);
  assert.deepEqual(result.knownPresent, [...KNOWN_SEARCH_DRIFT_STATEMENTS]);
  assert.deepEqual(result.knownMissing, []);
});

test("ignores the dotenv banner that shares stdout with the diff script", () => {
  const withBanner = `[dotenv@17.3.1] injecting env (24) from .env.local -- tip: x\n[dotenv@17.3.1] injecting env (0) from .env\n${KNOWN_DIFF}`;
  assert.deepEqual(classifyDriftStatements(withBanner).unexpected, []);
});

test("an empty diff has no statements and reports every known item as missing", () => {
  assert.deepEqual(splitSqlScript("-- This is an empty migration.\n"), []);
  const result = classifyDriftStatements("-- This is an empty migration.\n");
  assert.deepEqual(result.unexpected, []);
  assert.equal(result.knownMissing.length, KNOWN_SEARCH_DRIFT_STATEMENTS.length);
});

test("any other statement is reported as unexpected drift", () => {
  const extra = `${KNOWN_DIFF}\n-- AlterTable\nALTER TABLE "Sale" ADD COLUMN   "note" TEXT;\n`;
  assert.deepEqual(classifyDriftStatements(extra).unexpected, ['ALTER TABLE "Sale" ADD COLUMN "note" TEXT']);
});

test("an extra column dropped from product_search_documents is not hidden by the trgm_text allowance", () => {
  const merged = `-- AlterTable
ALTER TABLE "product_search_documents" DROP COLUMN "trgm_text",
DROP COLUMN "other";`;
  const result = classifyDriftStatements(merged);
  assert.equal(result.unexpected.length, 1);
  assert.match(result.unexpected[0], /DROP COLUMN "other"/);
});
