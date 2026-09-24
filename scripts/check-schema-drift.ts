/**
 * Read-only schema drift check.
 *
 * Runs `prisma migrate diff --from-config-datasource --to-schema
 * prisma/schema.prisma --script` against the database in prisma.config.ts
 * (DIRECT_URL ?? DATABASE_URL, loaded from .env.local / .env). The diff only
 * introspects the database — it never writes.
 *
 * The output is the SQL that would bring the database in line with the schema.
 * Six statements are known, intentional drift (search indexes and
 * product_search_documents.trgm_text created by prisma/scripts/setup-search-v2.ts
 * and setup-knowledge-rag.ts outside schema.prisma) and are filtered out; see
 * KNOWN_SEARCH_DRIFT_STATEMENTS in lib/prisma-db-push-guard.ts.
 *
 * Usage:   npx tsx scripts/check-schema-drift.ts
 * Exit:    0 = no unexpected drift, 1 = unexpected drift, 2 = the diff could not run
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { classifyDriftStatements, type DriftClassification } from "../lib/prisma-db-push-guard";

const EXIT_OK = 0;
const EXIT_UNEXPECTED_DRIFT = 1;
const EXIT_DIFF_FAILED = 2;
const DIFF_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

const PRISMA_CLI = join(process.cwd(), "node_modules", "prisma", "build", "index.js");
const DIFF_ARGS = [
  "migrate",
  "diff",
  "--from-config-datasource",
  "--to-schema",
  "prisma/schema.prisma",
  "--script",
] as const;

type DiffResult = { ok: true; script: string } | { ok: false; error: string };

const runPrismaDiff = (): DiffResult => {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...DIFF_ARGS], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: DIFF_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) {
    return { ok: false, error: `prisma migrate diff exited with ${result.status}\n${result.stderr.trim()}` };
  }
  return { ok: true, script: result.stdout };
};

const printReport = (classification: DriftClassification): void => {
  const { unexpected, knownPresent, knownMissing } = classification;
  console.log(`Known search drift ignored: ${knownPresent.length} statement(s).`);
  if (knownMissing.length > 0) {
    console.warn(
      "WARNING: expected search drift is absent — the database may be missing these search objects " +
        "(re-run prisma/scripts/setup-search-v2.ts / setup-knowledge-rag.ts if this is a real environment):",
    );
    for (const statement of knownMissing) console.warn(`  - ${statement}`);
  }
  if (unexpected.length === 0) {
    console.log("OK: no unexpected drift between the database and prisma/schema.prisma.");
    return;
  }
  console.error(`UNEXPECTED DRIFT: ${unexpected.length} statement(s) not covered by the known search drift:`);
  for (const statement of unexpected) console.error(`  ${statement};`);
  console.error(
    "\nApply missing schema objects with additive SQL in prisma/migrations/<YYYYMMDD>_<name>/migration.sql " +
      "(see .rules §6). Never resolve drift with `prisma db push`.",
  );
};

const main = (): number => {
  try {
    const diff = runPrismaDiff();
    if (!diff.ok) {
      console.error(`Could not run the drift check: ${diff.error}`);
      return EXIT_DIFF_FAILED;
    }
    const classification = classifyDriftStatements(diff.script);
    printReport(classification);
    return classification.unexpected.length === 0 ? EXIT_OK : EXIT_UNEXPECTED_DRIFT;
  } catch (error) {
    console.error("Drift check failed:", error instanceof Error ? error.message : error);
    return EXIT_DIFF_FAILED;
  }
};

process.exit(main());
