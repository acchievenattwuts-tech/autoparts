import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DESTRUCTIVE_DB_OVERRIDE_ENV } from "@/lib/destructive-db-script-guard";

// prisma/scripts/db-restore.ts and cleanup-product-transaction-data.ts bulk-delete
// business tables, so they must refuse production before the first connection.
// Each script runs in a child process the way `npx tsx <script>` runs it.
//
// Hermetic by construction: every URL points at a dead port on this machine
// (127.0.0.1:1), the production project ref sits in the pooler-style username
// (where the guard looks for it), and `.env` is never loaded. If a guard ever
// regressed, the script could only fail to connect — it cannot reach a database.

const PRODUCTION_REF = "lueeusrezzhokfikxjgi";
const PRODUCTION_LOOKING_URL = `postgresql://postgres.${PRODUCTION_REF}:secret@127.0.0.1:1/postgres`;
const PRODUCTION_LOOKING_TARGET = `postgres.${PRODUCTION_REF}@127.0.0.1:1/postgres`;
const LOCAL_DEAD_URL = "postgresql://postgres:secret@127.0.0.1:1/autoparts_guard_test";
const MISSING_SNAPSHOT = "guard-test-snapshot-that-does-not-exist.json";
const SCRIPT_TIMEOUT_MS = 60_000;

const DB_RESTORE = "prisma/scripts/db-restore.ts";
const CLEANUP = "prisma/scripts/cleanup-product-transaction-data.ts";

const repoRoot = process.cwd();

type ScriptRun = { status: number | null; output: string };

const runScript = (script: string, args: string[], env: Record<string, string>): ScriptRun => {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    // cleanup-product-transaction-data.ts imports "dotenv/config"; point it at a
    // file that does not exist so `.env` (production) is never read.
    DOTENV_CONFIG_PATH: path.join(os.tmpdir(), "autoparts-guard-test-no-such-file.env"),
    DOTENV_CONFIG_QUIET: "true",
  };
  delete childEnv[DESTRUCTIVE_DB_OVERRIDE_ENV];
  delete childEnv.DOTENV_CONFIG_OVERRIDE;
  delete childEnv.NODE_TEST_CONTEXT;
  Object.assign(childEnv, env);

  const result = spawnSync(process.execPath, ["--import", "tsx", path.join(repoRoot, script), ...args], {
    cwd: repoRoot,
    env: childEnv,
    encoding: "utf8",
    input: "",
    timeout: SCRIPT_TIMEOUT_MS,
  });
  assert.equal(result.error, undefined, `${script} could not be started: ${String(result.error)}`);
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
};

const assertRefusedBeforeAnyQuery = (run: ScriptRun, label: string): void => {
  assert.equal(run.status, 1, `${label}: exit code\n${run.output}`);
  assert.match(run.output, /REFUSED — DATABASE_URL points at the production Supabase project/, label);
  assert.match(run.output, new RegExp(`\\(${PRODUCTION_REF}\\)`), label);
  assert.match(run.output, /Nothing was read or deleted\./, label);
  assert.ok(!run.output.includes("secret"), `${label}: output must never contain the password`);
  // Nothing past the guard ran: no connection attempt, no snapshot read, no row counts.
  for (const marker of ["ECONNREFUSED", "File not found", "Clearing all tables", "Target row counts", "Cleanup failed"]) {
    assert.ok(!run.output.includes(marker), `${label}: reached "${marker}"\n${run.output}`);
  }
};

test("db-restore refuses a production DATABASE_URL before reading the snapshot or deleting anything", () => {
  const run = runScript(DB_RESTORE, [MISSING_SNAPSHOT], { DATABASE_URL: PRODUCTION_LOOKING_URL });
  assertRefusedBeforeAnyQuery(run, "db-restore");
});

test("cleanup-product-transaction-data refuses a production DATABASE_URL, dry run and --execute alike", () => {
  assertRefusedBeforeAnyQuery(
    runScript(CLEANUP, [], { DATABASE_URL: PRODUCTION_LOOKING_URL }),
    "cleanup (dry run)",
  );
  assertRefusedBeforeAnyQuery(
    runScript(CLEANUP, ["--execute"], { DATABASE_URL: PRODUCTION_LOOKING_URL }),
    "cleanup --execute",
  );
});

test("naming the production target in the override env still does not unlock either script", () => {
  const env = { DATABASE_URL: PRODUCTION_LOOKING_URL, [DESTRUCTIVE_DB_OVERRIDE_ENV]: PRODUCTION_LOOKING_TARGET };
  assertRefusedBeforeAnyQuery(runScript(DB_RESTORE, [MISSING_SNAPSHOT], env), "db-restore with override");
  assertRefusedBeforeAnyQuery(runScript(CLEANUP, ["--execute"], env), "cleanup with override");
});

test("db-restore still runs as before against a local database (stops at the missing snapshot)", () => {
  const run = runScript(DB_RESTORE, [MISSING_SNAPSHOT], { DATABASE_URL: LOCAL_DEAD_URL });
  assert.equal(run.status, 1, run.output);
  assert.ok(!run.output.includes("REFUSED"), run.output);
  assert.match(run.output, /File not found: .*guard-test-snapshot-that-does-not-exist\.json/);
});
