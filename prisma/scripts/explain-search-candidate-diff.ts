/**
 * EXPLAIN ANALYZE — candidate-clause before/after comparison.
 *
 * Proves the "index-only candidate OR" change (buildCandidateTextMatchSql) is:
 *   1. FASTER   — the plan flips from a Seq Scan on product_search_documents to a
 *                 Bitmap Heap Scan driven by a BitmapOr of the GIN indexes.
 *   2. IDENTICAL — the OLD and NEW candidate clauses return the exact same set of
 *                 product_ids (so ranking/results downstream are unchanged).
 *
 * It isolates ONLY the candidate-selection WHERE clause (the part that changed).
 * The scope is intentionally minimal (is_active = true) so the plan reflects the
 * candidate OR's index usage rather than being dominated by the storefront-visible
 * EXISTS join. Scoring, vector recall, and pagination are out of scope here.
 *
 *   OLD clause = pre-change: equality + alias_text branches + bare `similarity() >=`
 *   NEW clause = post-change: subsumed branches dropped + `col % q AND similarity()>=`
 *                with SET LOCAL pg_trgm.similarity_threshold = 0.12
 *
 * Usage:
 *   npx tsx --env-file=.env.local prisma/scripts/explain-search-candidate-diff.ts
 *   npx tsx --env-file=.env.local prisma/scripts/explain-search-candidate-diff.ts "ผ้าเบรค vios" "w3-7044" "หม้อน้ำ"
 *
 * Read-only: every statement runs inside a transaction that is ROLLED BACK.
 */
import { Pool, type PoolClient } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

// Mirror the app's per-column similarity floors + candidate `%` threshold.
const CODE_SIM = 0.2;
const OEM_SIM = 0.2;
const NAME_SIM = 0.18;
const TEXT_SIM = 0.12;
const TRGM_THRESHOLD = Math.min(CODE_SIM, OEM_SIM, NAME_SIM, TEXT_SIM); // 0.12
const STATEMENT_TIMEOUT_MS = 15_000;

const DEFAULT_QUERIES = ["ผ้าเบรค vios", "หม้อน้ำ", "vios", "compressor"];

// Shared branches (unchanged between OLD and NEW) — the `@@ tsquery` full-text
// branch. plainto_tsquery keeps it simple + identical on both sides so it never
// skews the diff.
const tsBranch = "psd.search_document @@ plainto_tsquery('simple', f_unaccent($1))";

/** OLD candidate OR: equality + alias_text + bare similarity() >= (forces seq scan). */
const buildOldClause = (): string => `
     f_unaccent(lower(psd.product_code)) = f_unaccent(lower($1))
  OR f_unaccent(lower(psd.product_name)) = f_unaccent(lower($1))
  OR f_unaccent(lower(psd.product_code)) LIKE f_unaccent(lower($2))
  OR f_unaccent(lower(psd.product_name)) LIKE f_unaccent(lower($2))
  OR f_unaccent(lower(psd.oem_text)) LIKE f_unaccent(lower($3))
  OR f_unaccent(lower(psd.keyword_text)) LIKE f_unaccent(lower($3))
  OR f_unaccent(lower(psd.alias_text)) LIKE f_unaccent(lower($3))
  OR f_unaccent(lower(psd.search_text)) LIKE f_unaccent(lower($3))
  OR ${tsBranch}
  OR similarity(f_unaccent(lower(psd.product_code)), f_unaccent(lower($1))) >= ${CODE_SIM}
  OR similarity(f_unaccent(lower(psd.oem_text)), f_unaccent(lower($1))) >= ${OEM_SIM}
  OR similarity(f_unaccent(lower(psd.product_name)), f_unaccent(lower($1))) >= ${NAME_SIM}
  OR similarity(f_unaccent(lower(psd.search_text)), f_unaccent(lower($1))) >= ${TEXT_SIM}
`;

/** NEW candidate OR: subsumed branches dropped + `%` probe (index-only). */
const buildNewClause = (): string => `
     f_unaccent(lower(psd.product_code)) LIKE f_unaccent(lower($2))
  OR f_unaccent(lower(psd.product_name)) LIKE f_unaccent(lower($2))
  OR f_unaccent(lower(psd.oem_text)) LIKE f_unaccent(lower($3))
  OR f_unaccent(lower(psd.keyword_text)) LIKE f_unaccent(lower($3))
  OR f_unaccent(lower(psd.search_text)) LIKE f_unaccent(lower($3))
  OR ${tsBranch}
  OR (f_unaccent(lower(psd.product_code)) % f_unaccent(lower($1))
      AND similarity(f_unaccent(lower(psd.product_code)), f_unaccent(lower($1))) >= ${CODE_SIM})
  OR (f_unaccent(lower(psd.oem_text)) % f_unaccent(lower($1))
      AND similarity(f_unaccent(lower(psd.oem_text)), f_unaccent(lower($1))) >= ${OEM_SIM})
  OR (f_unaccent(lower(psd.product_name)) % f_unaccent(lower($1))
      AND similarity(f_unaccent(lower(psd.product_name)), f_unaccent(lower($1))) >= ${NAME_SIM})
  OR (f_unaccent(lower(psd.search_text)) % f_unaccent(lower($1))
      AND similarity(f_unaccent(lower(psd.search_text)), f_unaccent(lower($1))) >= ${TEXT_SIM})
`;

const selectSql = (clause: string): string =>
  `SELECT psd.product_id
     FROM product_search_documents psd
     WHERE psd.is_active = true
       AND (${clause})`;

type PlanNode = {
  "Node Type": string;
  "Actual Total Time"?: number;
  "Actual Rows"?: number;
  Plans?: PlanNode[];
};
type ExplainRoot = { Plan: PlanNode; "Execution Time": number };

const walk = (node: PlanNode, types: Set<string>): void => {
  types.add(node["Node Type"]);
  for (const child of node.Plans ?? []) walk(child, types);
};

const params = (query: string): [string, string, string] => [query, `${query}%`, `%${query}%`];

const explain = async (
  client: PoolClient,
  label: string,
  clause: string,
  query: string,
  applyThreshold: boolean,
): Promise<{ execMs: number; nodeTypes: Set<string>; textPlan: string }> => {
  await client.query("BEGIN");
  try {
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    if (applyThreshold) {
      await client.query(`SELECT set_config('pg_trgm.similarity_threshold', $1, true)`, [
        String(TRGM_THRESHOLD),
      ]);
    }
    const jsonRes = await client.query<{ "QUERY PLAN": ExplainRoot[] }>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${selectSql(clause)}`,
      params(query),
    );
    const root = jsonRes.rows[0]["QUERY PLAN"][0];
    const nodeTypes = new Set<string>();
    walk(root.Plan, nodeTypes);

    const textRes = await client.query<{ "QUERY PLAN": string }>(
      `EXPLAIN (ANALYZE, COSTS OFF) ${selectSql(clause)}`,
      params(query),
    );
    const textPlan = textRes.rows.map((r) => r["QUERY PLAN"]).join("\n");
    return { execMs: root["Execution Time"], nodeTypes, textPlan };
  } finally {
    await client.query("ROLLBACK"); // read-only: never persist
  }
};

const fetchIds = async (
  client: PoolClient,
  clause: string,
  query: string,
  applyThreshold: boolean,
): Promise<Set<string>> => {
  await client.query("BEGIN");
  try {
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    if (applyThreshold) {
      await client.query(`SELECT set_config('pg_trgm.similarity_threshold', $1, true)`, [
        String(TRGM_THRESHOLD),
      ]);
    }
    const res = await client.query<{ product_id: string }>(selectSql(clause), params(query));
    return new Set(res.rows.map((r) => r.product_id));
  } finally {
    await client.query("ROLLBACK");
  }
};

const summarizePlan = (nodeTypes: Set<string>): string => {
  const seq = nodeTypes.has("Seq Scan");
  const bitmap = nodeTypes.has("Bitmap Heap Scan") || nodeTypes.has("BitmapOr");
  if (bitmap && !seq) return "✅ Bitmap index scan (no seq scan)";
  if (bitmap && seq) return "⚠️  Mixed (bitmap + seq scan)";
  if (seq) return "❌ Seq Scan";
  return `ℹ️  ${Array.from(nodeTypes).join(", ")}`;
};

const setsEqual = (a: Set<string>, b: Set<string>): boolean =>
  a.size === b.size && Array.from(a).every((x) => b.has(x));

async function main(): Promise<void> {
  const queries = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_QUERIES;
  const oldClause = buildOldClause();
  const newClause = buildNewClause();

  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 8_000 });
  const client = await pool.connect();

  let allIdentical = true;
  try {
    for (const query of queries) {
      console.log("\n" + "═".repeat(72));
      console.log(`QUERY: "${query}"`);
      console.log("═".repeat(72));

      const before = await explain(client, "OLD", oldClause, query, false);
      const after = await explain(client, "NEW", newClause, query, true);

      const oldIds = await fetchIds(client, oldClause, query, false);
      const newIds = await fetchIds(client, newClause, query, true);
      const identical = setsEqual(oldIds, newIds);
      if (!identical) allIdentical = false;

      const speedup = before.execMs > 0 ? (before.execMs / after.execMs).toFixed(2) : "n/a";

      console.log(`\n  OLD  plan: ${summarizePlan(before.nodeTypes)}`);
      console.log(`       exec: ${before.execMs.toFixed(1)} ms | rows: ${oldIds.size}`);
      console.log(`  NEW  plan: ${summarizePlan(after.nodeTypes)}`);
      console.log(`       exec: ${after.execMs.toFixed(1)} ms | rows: ${newIds.size}`);
      console.log(`  Speedup:   ${speedup}x`);
      console.log(
        `  Results:   ${identical ? "✅ IDENTICAL id set" : "❌ DIFFERENT — investigate before deploy"}`,
      );

      if (!identical) {
        const onlyOld = Array.from(oldIds).filter((x) => !newIds.has(x)).slice(0, 10);
        const onlyNew = Array.from(newIds).filter((x) => !oldIds.has(x)).slice(0, 10);
        console.log(`    only in OLD (${oldIds.size - newIds.size >= 0 ? "" : "+"}): ${onlyOld.join(", ")}`);
        console.log(`    only in NEW: ${onlyNew.join(", ")}`);
      }

      console.log("\n  --- NEW text plan ---");
      console.log(
        after.textPlan
          .split("\n")
          .map((line) => "    " + line)
          .join("\n"),
      );
    }

    console.log("\n" + "═".repeat(72));
    console.log(
      allIdentical
        ? "✅ ALL queries returned identical id sets — safe to deploy."
        : "❌ Some queries DIFFERED — do NOT deploy until reconciled.",
    );
    console.log("═".repeat(72));
    if (!allIdentical) process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("explain-search-candidate-diff failed.");
  console.error(error);
  process.exitCode = 1;
});
