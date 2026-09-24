/**
 * Guard against `prisma db push` on the production database, plus the list of
 * known, intentional schema drift that the push (and `prisma migrate diff`)
 * would otherwise "fix" by dropping it.
 *
 * Why: `prisma/scripts/setup-search-v2.ts` and `setup-knowledge-rag.ts` create
 * search indexes and the generated column `product_search_documents.trgm_text`
 * outside `prisma/schema.prisma`, so a push drops all of them. Schema changes are
 * applied as narrow additive SQL instead (see `.rules` §6).
 *
 * Pure — no DB, no process access — so `prisma.config.ts`, the drift-check
 * script and unit tests can all share it. The target rules (production refused,
 * localhost allowed, other remote hosts only with an explicit per-target
 * approval) come from `lib/destructive-db-script-guard.ts`.
 */
import {
  checkDestructiveDbTarget,
  DESTRUCTIVE_DB_OVERRIDE_ENV,
  PRODUCTION_SUPABASE_PROJECT_REFS,
} from "./destructive-db-script-guard";

export const PROD_DB_PUSH_OVERRIDE_ENV = "ALLOW_PROD_DB_PUSH";
export const PROD_DB_PUSH_OVERRIDE_VALUE = "I_UNDERSTAND_THIS_DROPS_SEARCH_INDEXES";

/** Prisma CLI flags that take a separate value token (`--schema path`). */
const VALUE_FLAGS: ReadonlySet<string> = new Set(["--config", "--schema", "--url"]);
const HELP_FLAGS: ReadonlySet<string> = new Set(["-h", "--help"]);

/**
 * Statements `prisma migrate diff --from-config-datasource --to-schema
 * prisma/schema.prisma --script` emits for the intentional search drift,
 * normalized with `normalizeSqlStatement()`.
 */
export const KNOWN_SEARCH_DRIFT_STATEMENTS: readonly string[] = [
  'DROP INDEX "idx_knowledge_documents_search_document"',
  'DROP INDEX "idx_knowledge_documents_search_text_trgm"',
  'DROP INDEX "idx_product_search_documents_keyword_trgm"',
  'DROP INDEX "idx_product_search_documents_oem_trgm"',
  'DROP INDEX "idx_psd_embedding_hnsw"',
  'ALTER TABLE "product_search_documents" DROP COLUMN "trgm_text"',
];

export type DbPushGuardDecision =
  | { blocked: false; reason: string }
  | { blocked: true; target: string | null; message: string };

export interface DbPushGuardInput {
  /** CLI arguments after the script path — `process.argv.slice(2)`. */
  cliArgs: readonly string[];
  /** The URL prisma.config.ts hands Prisma (`DIRECT_URL ?? DATABASE_URL`). */
  configUrl: string | undefined;
  /** Value of `ALLOW_PROD_DB_PUSH`. */
  prodOverride: string | undefined;
  /** Value of `ALLOW_DESTRUCTIVE_DB_SCRIPT` (per-target approval for non-local hosts). */
  targetOverride: string | undefined;
}

interface ParsedCli {
  positionals: string[];
  flags: Map<string, string | true>;
}

const parseCliArgs = (cliArgs: readonly string[]): ParsedCli => {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < cliArgs.length; i += 1) {
    const token = cliArgs[i];
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    if (eq > 0) {
      flags.set(token.slice(0, eq), token.slice(eq + 1));
    } else if (VALUE_FLAGS.has(token) && i + 1 < cliArgs.length) {
      flags.set(token, cliArgs[i + 1]);
      i += 1;
    } else {
      flags.set(token, true);
    }
  }
  return { positionals, flags };
};

/** True when the Prisma CLI was invoked as `prisma db push …`. */
export const isPrismaDbPushInvocation = (cliArgs: readonly string[]): boolean => {
  const { positionals } = parseCliArgs(cliArgs);
  return positionals[0] === "db" && positionals[1] === "push";
};

/** `--url` on the command line overrides the config datasource for `db push`. */
export const resolveDbPushTargetUrl = (
  cliArgs: readonly string[],
  configUrl: string | undefined,
): string | undefined => {
  const cliUrl = parseCliArgs(cliArgs).flags.get("--url");
  return typeof cliUrl === "string" && cliUrl.trim() ? cliUrl : configUrl;
};

const isProductionTarget = (target: string | null): boolean =>
  target !== null &&
  PRODUCTION_SUPABASE_PROJECT_REFS.some((ref) => target.toLowerCase().includes(ref.toLowerCase()));

export const buildDbPushBlockedMessage = (target: string | null, detail: string): string =>
  [
    "",
    "[prisma.config.ts] BLOCKED: `prisma db push` — ห้ามใช้ db push กับฐานข้อมูลนี้",
    `  target: ${target ?? "(unknown)"}`,
    `  detail: ${detail}`,
    "",
    "  TH: ฐานข้อมูลมี index ค้นหา 5 ตัวและคอลัมน์ product_search_documents.trgm_text ที่สร้างโดย",
    "      prisma/scripts/setup-search-v2.ts / setup-knowledge-rag.ts และไม่อยู่ใน prisma/schema.prisma",
    "      db push จะ DROP ทั้งหมด ทำให้การค้นหาสินค้า/คลังความรู้เสีย",
    "  EN: The database holds 5 search indexes and product_search_documents.trgm_text that live outside",
    "      prisma/schema.prisma. db push DROPS them and breaks product / knowledge search.",
    "",
    "  Procedure / ขั้นตอนที่ถูกต้อง (.rules §6):",
    "    1. Write additive SQL in prisma/migrations/<YYYYMMDD>_<name>/migration.sql",
    "       (ADD COLUMN / CREATE TABLE ... IF NOT EXISTS; CREATE INDEX CONCURRENTLY, one statement at a time).",
    "    2. Apply it with `prisma db execute --file <path>` (index statements separately, outside a transaction).",
    "    3. Run `npx tsx scripts/check-schema-drift.ts` — it must report no unexpected drift.",
    "",
    `  Override (only if you really mean it): ${PROD_DB_PUSH_OVERRIDE_ENV}=${PROD_DB_PUSH_OVERRIDE_VALUE}`,
    "  and re-run prisma/scripts/setup-search-v2.ts + setup-knowledge-rag.ts right after the push.",
    "",
  ].join("\n");

/**
 * Decide whether prisma.config.ts must refuse to load. Only `db push` is ever
 * blocked; `generate`, `validate`, `migrate diff`, `db execute`, etc. pass.
 */
export const checkPrismaDbPush = (input: DbPushGuardInput): DbPushGuardDecision => {
  if (!isPrismaDbPushInvocation(input.cliArgs)) {
    return { blocked: false, reason: "not a `prisma db push` invocation" };
  }
  const { flags } = parseCliArgs(input.cliArgs);
  if ([...HELP_FLAGS].some((flag) => flags.has(flag))) {
    return { blocked: false, reason: "help only — no database access" };
  }
  if (input.prodOverride?.trim() === PROD_DB_PUSH_OVERRIDE_VALUE) {
    return { blocked: false, reason: `${PROD_DB_PUSH_OVERRIDE_ENV} override is set` };
  }

  const url = resolveDbPushTargetUrl(input.cliArgs, input.configUrl);
  const check = checkDestructiveDbTarget(url, input.targetOverride);
  if (check.allowed) {
    return { blocked: false, reason: `target ${check.target} is local or explicitly approved` };
  }

  const detail = isProductionTarget(check.target)
    ? "target is the PRODUCTION Supabase project / เป้าหมายคือฐานข้อมูล production"
    : check.target === null
      ? check.reason
      : `${check.reason} (non-production remote hosts can also be approved with ${DESTRUCTIVE_DB_OVERRIDE_ENV}).`;
  return { blocked: true, target: check.target, message: buildDbPushBlockedMessage(check.target, detail) };
};

// ---------------------------------------------------------------------------
// Drift-check helpers (used by scripts/check-schema-drift.ts)
// ---------------------------------------------------------------------------

/** Strip trailing `;` and collapse whitespace so statements compare reliably. */
export const normalizeSqlStatement = (statement: string): string =>
  statement.replace(/;\s*$/, "").replace(/\s+/g, " ").trim();

/**
 * Lines that are not SQL: comments, and the `[dotenv@x] injecting env …` banner
 * dotenv 17 prints to stdout when prisma.config.ts loads the env files.
 */
const isNonSqlLine = (line: string): boolean => {
  const trimmed = line.trim();
  return trimmed.startsWith("--") || trimmed.startsWith("[dotenv@");
};

/** Split a `prisma migrate diff --script` output into normalized statements. */
export const splitSqlScript = (script: string): string[] =>
  script
    .split(/\r?\n/)
    .filter((line) => !isNonSqlLine(line))
    .join("\n")
    .split(";")
    .map(normalizeSqlStatement)
    .filter((statement) => statement.length > 0);

export interface DriftClassification {
  unexpected: string[];
  knownPresent: string[];
  knownMissing: string[];
}

export const classifyDriftStatements = (script: string): DriftClassification => {
  const statements = splitSqlScript(script);
  const known = new Set(KNOWN_SEARCH_DRIFT_STATEMENTS);
  const present = new Set(statements.filter((statement) => known.has(statement)));
  return {
    unexpected: statements.filter((statement) => !known.has(statement)),
    knownPresent: KNOWN_SEARCH_DRIFT_STATEMENTS.filter((statement) => present.has(statement)),
    knownMissing: KNOWN_SEARCH_DRIFT_STATEMENTS.filter((statement) => !present.has(statement)),
  };
};
