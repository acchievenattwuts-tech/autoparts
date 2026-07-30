/**
 * Experiment: what happens if the hybrid page ALSO merges the broad OR recall?
 *
 * Today, when the fast lexical pass returns nothing but vector recall returns
 * rows, `rows.length === 0` is false and the broad OR-recall fallback in
 * `searchProductIdsV2` never runs — so the page becomes vector-only and `total`
 * shrinks (e.g. 58 → 11). This script contrasts the current candidate set
 * (precise AND tsquery + vector) against the merged one (OR tsquery + vector)
 * using the full production score formula, including `ts_rank_cd`.
 *
 * The point of measuring rather than assuming: the OR full-text term is worth
 * hundreds of points to a row that matches only the CAR name, which is larger
 * than the entire semantic band — so a naive merge can demote the correct part.
 *
 * Read-only. Costs one Gemini query-embedding per query.
 *
 *   npm run experiment:semantic-or-merge -- "รังผึ้งระบายความร้อน ซิตี้"
 */
import { Prisma } from "@/lib/generated/prisma";
import type { Prisma as PrismaTypes } from "@/lib/generated/prisma";
import { embedQuery, toPgVectorLiteral } from "@/lib/embeddings";
import { normalizeSearchText } from "@/lib/search-normalization";
import { expandQueryTokenGroups } from "@/lib/search-synonyms";
import { buildCandidateTextMatchSql, buildTsQueryExpression } from "@/lib/product-search";
import {
  buildQueryForms,
  ftsScoreSql,
  lexicalScoreSql,
  runHarness,
  runInSearchTx,
  salesScoreSql,
  shortCategory,
  stockScoreSql,
  trigramScoreSql,
  vectorRecallCteSql,
  SEARCH_V2_VECTOR_WEIGHT,
  type QueryForms,
} from "./semantic-eval-core";

const DEFAULT_QUERIES = [
  "รังผึ้งระบายความร้อน ซิตี้",
  "ตัวกรองฝุ่นในห้องโดยสาร ซีวิค",
  "ถังน้ำหล่อเย็นหน้ารถ ซิตี้",
];
const SHOW_ROWS = 6;

type MergeRow = {
  product_code: string;
  product_name: string;
  category_name: string;
  score: number;
  sim: number | null;
  vector_only: boolean;
  total_count: bigint;
};

const runCandidateSet = async (
  forms: QueryForms,
  qvec: string,
  expression: string,
  label: string,
): Promise<void> => {
  const ts = Prisma.sql`to_tsquery('simple', f_unaccent(${expression}))`;
  const textMatchOr: PrismaTypes.Sql = buildCandidateTextMatchSql({
    normalizedQuery: forms.normalized,
    prefixQuery: forms.prefix,
    containsQuery: forms.contains,
    ts,
  });
  const startedAt = Date.now();
  const rows = await runInSearchTx((tx) =>
    tx.$queryRaw<MergeRow[]>(Prisma.sql`
      WITH ${vectorRecallCteSql(qvec)},
      ranked AS (
        SELECT
          psd.product_code, psd.product_name, psd.category_name, v.sim,
          (v.product_id IS NOT NULL AND NOT (${textMatchOr})) AS vector_only,
          (
            ${lexicalScoreSql(forms)} +
            ${ftsScoreSql(ts)} +
            ${trigramScoreSql(forms)} +
            ${stockScoreSql} +
            ${salesScoreSql} +
            COALESCE(v.sim, 0) * ${SEARCH_V2_VECTOR_WEIGHT}
          )::float8 AS score
        FROM product_search_documents psd
        LEFT JOIN vec v ON v.product_id = psd.product_id
        WHERE psd.is_active = true
          AND ((${textMatchOr}) OR v.product_id IS NOT NULL)
      )
      SELECT ranked.*, COUNT(*) OVER() AS total_count
      FROM ranked
      WHERE ranked.score > 0
      ORDER BY ranked.score DESC
      LIMIT ${SHOW_ROWS}
    `),
  );
  const elapsedMs = Date.now() - startedAt;
  console.log(
    `  ${label.padEnd(22)} total=${rows.length > 0 ? Number(rows[0].total_count) : 0} ${elapsedMs}ms`,
  );
  for (const row of rows) {
    console.log(
      `      ${row.score.toFixed(0).padStart(5)} ${row.vector_only ? "V" : " "}` +
        ` sim=${row.sim === null ? "  -  " : row.sim.toFixed(3)}` +
        ` [${shortCategory(row.category_name)}] ${row.product_code} ${row.product_name.slice(0, 42)}`,
    );
  }
};

async function main(): Promise<void> {
  const argQuery = process.argv.slice(2).join(" ").trim();
  const queries = argQuery ? [argQuery] : DEFAULT_QUERIES;

  for (const query of queries) {
    const normalized = normalizeSearchText(query);
    if (!normalized) continue;
    const forms = buildQueryForms(normalized);
    const groups = await expandQueryTokenGroups(normalized, { bypassCache: true });
    const andExpression = buildTsQueryExpression(groups, "and");
    const orExpression = buildTsQueryExpression(groups, "or");
    const queryVector = await embedQuery(normalized, { bypassCache: true });
    if (!queryVector) {
      console.log(`\n=== "${query}" → query embedding unavailable (skipped)`);
      continue;
    }
    const qvec = toPgVectorLiteral(queryVector);

    console.log(`\n=== "${query}"  (V marks a row with no lexical evidence)`);
    if (andExpression) await runCandidateSet(forms, qvec, andExpression, "current (AND + vec)");
    if (orExpression && orExpression !== andExpression) {
      await runCandidateSet(forms, qvec, orExpression, "merged (OR + vec)");
    } else {
      console.log("  merged (OR + vec)      single-concept query — OR equals AND, nothing to merge");
    }
  }
}

runHarness(main, "experiment-semantic-or-merge");
