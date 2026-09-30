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
 * KNOWN_SEARCH_DRIFT_STATEMENTS in lib/prisma-db-push-guard.ts. Objects that
 * schema.prisma cannot express are filtered by KNOWN_UNMODELED_DRIFT_STATEMENTS
 * below. Every other statement is unexpected drift.
 *
 * Usage:   npx tsx scripts/check-schema-drift.ts
 * Exit:    0 = no unexpected drift, 1 = unexpected drift, 2 = the diff could not run
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { classifyDriftStatements, type DriftClassification } from "../lib/prisma-db-push-guard";

/**
 * Known drift for database objects schema.prisma cannot express, compared exactly after normalizeSqlStatement(),
 * like KNOWN_SEARCH_DRIFT_STATEMENTS. One statement per object; never a pattern.
 *
 * - "SupplierDebitNote_active_supplier_reference_key" (T4, 2026-09-30,
 *   prisma/migrations/20260930_review_round4/indexes/01.sql): partial expression unique index keeping a supplier's DN
 *   number unique among ACTIVE DNs only (see normalizeSupplierReferenceKey in lib/supplier-debit-note.ts). The diff
 *   proposes dropping it. Prisma may also skip expression indexes when it introspects, so its absence from the diff
 *   says nothing about whether the index exists, and is not reported as missing.
 */
export const KNOWN_UNMODELED_DRIFT_STATEMENTS: readonly string[] = [
  'DROP INDEX "SupplierDebitNote_active_supplier_reference_key"',
];

export type SchemaDriftReport = DriftClassification & { unmodeledPresent: string[] };

/** Search drift first (lib/prisma-db-push-guard.ts), then the unmodeled allowlist; anything else stays unexpected. */
export const classifySchemaDrift = (script: string): SchemaDriftReport => {
  const classification = classifyDriftStatements(script);
  const unmodeled = new Set(KNOWN_UNMODELED_DRIFT_STATEMENTS);
  return {
    ...classification,
    unexpected: classification.unexpected.filter((statement) => !unmodeled.has(statement)),
    unmodeledPresent: classification.unexpected.filter((statement) => unmodeled.has(statement)),
  };
};

export const EXIT_OK = 0;
export const EXIT_UNEXPECTED_DRIFT = 1;
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

/** Exit 1 for any statement outside both allowlists. */
export const driftExitCode = (report: SchemaDriftReport): number =>
  report.unexpected.length === 0 ? EXIT_OK : EXIT_UNEXPECTED_DRIFT;

const printReport = (classification: SchemaDriftReport): void => {
  const { unexpected, knownPresent, knownMissing, unmodeledPresent } = classification;
  console.log(`Known search drift ignored: ${knownPresent.length} statement(s).`);
  console.log(`Known unmodeled-object drift ignored: ${unmodeledPresent.length} statement(s).`);
  for (const statement of unmodeledPresent) console.log(`  - ${statement}`);
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
  console.error(`UNEXPECTED DRIFT: ${unexpected.length} statement(s) not covered by the known drift allowlists:`);
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
    const classification = classifySchemaDrift(diff.script);
    printReport(classification);
    return driftExitCode(classification);
  } catch (error) {
    console.error("Drift check failed:", error instanceof Error ? error.message : error);
    return EXIT_DIFF_FAILED;
  }
};

/**
 * True when run as a script; false when a unit test imports the helpers above. require.main is exact under CommonJS
 * (how tsx loads this repo's .ts today); the file-name check keeps a direct run working if the repo moves to ESM.
 */
const isDirectRun = (): boolean =>
  (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) ||
  /check-schema-drift(\.ts)?$/.test(process.argv[1] ?? "");

if (isDirectRun()) process.exit(main());
