/**
 * Shared core for the offline semantic-retrieval harness.
 *
 * WHY THIS EXISTS
 * `searchProductIdsV2` returns ids + a few signals, but not the per-row score
 * breakdown, and it cannot re-rank a fixed candidate set under a hypothetical
 * weighting. Answering "would proposal X actually improve ranking?" therefore
 * requires reproducing the production score outside the search path.
 *
 * ⚠️  The score expression below MIRRORS the one inside
 * `runRankedQuery` (lib/product-search.ts). It is a measurement copy, never a
 * source of truth: if the production weights change, update this file in the
 * same round or the harness silently measures the wrong thing. Weights that the
 * search module exports (vector weight / min similarity / recall limit) are
 * imported rather than copied.
 *
 * Everything here is READ-ONLY against the database.
 */
import { Prisma } from "@/lib/generated/prisma";
import type { Prisma as PrismaTypes } from "@/lib/generated/prisma";
import { db, dbSearchTx } from "@/lib/db";
import {
  SEARCH_V2_TRGM_CANDIDATE_THRESHOLD,
  SEARCH_V2_VECTOR_MIN_SIMILARITY,
  SEARCH_V2_VECTOR_RECALL_LIMIT,
  SEARCH_V2_VECTOR_WEIGHT,
} from "@/lib/product-search";

export {
  SEARCH_V2_VECTOR_MIN_SIMILARITY,
  SEARCH_V2_VECTOR_RECALL_LIMIT,
  SEARCH_V2_VECTOR_WEIGHT,
};

/** HNSW breadth used by production semantic recall (SEARCH_V2_HNSW_EF_SEARCH). */
export const HNSW_EF_SEARCH = "100";

export type QueryForms = {
  /** normalizeSearchText() output — what the search path actually queries with. */
  normalized: string;
  prefix: string;
  contains: string;
};

export const buildQueryForms = (normalizedQuery: string): QueryForms => ({
  normalized: normalizedQuery,
  prefix: `${normalizedQuery}%`,
  contains: `%${normalizedQuery}%`,
});

/**
 * Exact / prefix / contains terms of the production score. Mirrors the first two
 * blocks of the score expression in runRankedQuery.
 */
export const lexicalScoreSql = (q: QueryForms): PrismaTypes.Sql => Prisma.sql`
  CASE WHEN f_unaccent(lower(psd.product_code)) = f_unaccent(lower(${q.normalized})) THEN 1500 ELSE 0 END +
  CASE WHEN f_unaccent(lower(psd.oem_text)) ~ ('(^|\s)' || f_unaccent(lower(${q.normalized})) || '($|\s)') THEN 1400 ELSE 0 END +
  CASE WHEN f_unaccent(lower(psd.product_name)) = f_unaccent(lower(${q.normalized})) THEN 1000 ELSE 0 END +
  CASE WHEN f_unaccent(lower(psd.search_text)) = f_unaccent(lower(${q.normalized})) THEN 800 ELSE 0 END +
  CASE WHEN f_unaccent(lower(psd.product_code)) LIKE f_unaccent(lower(${q.prefix})) THEN 380 ELSE 0 END +
  CASE WHEN f_unaccent(lower(psd.product_name)) LIKE f_unaccent(lower(${q.prefix})) THEN 320 ELSE 0 END +
  CASE WHEN f_unaccent(lower(psd.oem_text)) LIKE f_unaccent(lower(${q.contains})) THEN 600 ELSE 0 END +
  CASE WHEN f_unaccent(lower(psd.keyword_text)) LIKE f_unaccent(lower(${q.contains})) THEN 250 ELSE 0 END +
  CASE WHEN f_unaccent(lower(psd.alias_text)) LIKE f_unaccent(lower(${q.contains})) THEN 250 ELSE 0 END +
  CASE WHEN f_unaccent(lower(psd.fitment_text)) LIKE f_unaccent(lower(${q.contains})) THEN 200 ELSE 0 END +
  CASE WHEN f_unaccent(lower(psd.product_description)) LIKE f_unaccent(lower(${q.contains})) THEN 80 ELSE 0 END
`;

/** Trigram block (GREATEST over the five searchable columns). */
export const trigramScoreSql = (q: QueryForms): PrismaTypes.Sql => Prisma.sql`
  GREATEST(
    similarity(f_unaccent(lower(psd.product_code)), f_unaccent(lower(${q.normalized}))) * 420,
    similarity(f_unaccent(lower(psd.oem_text)), f_unaccent(lower(${q.normalized}))) * 380,
    similarity(f_unaccent(lower(psd.product_name)), f_unaccent(lower(${q.normalized}))) * 250,
    similarity(f_unaccent(lower(psd.keyword_text)), f_unaccent(lower(${q.normalized}))) * 180,
    similarity(f_unaccent(lower(psd.search_text)), f_unaccent(lower(${q.normalized}))) * 120
  )
`;

/** Full-text rank block. Pass the tsquery the caller wants to measure. */
export const ftsScoreSql = (ts: PrismaTypes.Sql): PrismaTypes.Sql => Prisma.sql`
  CASE WHEN psd.search_document @@ ${ts} THEN ts_rank_cd(psd.search_document, ${ts}) * 220 ELSE 0 END
`;

/** Phase Q7 popularity / availability tie-breakers. */
export const stockScoreSql = Prisma.sql`CASE WHEN psd.stock > 0 THEN 60 ELSE 0 END`;
export const salesScoreSql = Prisma.sql`LEAST(psd.sales_count, 100) * 1.2`;

/** Vector recall CTE — same filters, threshold and limit as production. */
export const vectorRecallCteSql = (qvec: string): PrismaTypes.Sql => Prisma.sql`
  vec AS (
    SELECT psd.product_id, (1 - (psd.embedding <=> ${qvec}::vector))::float8 AS sim
    FROM product_search_documents psd
    WHERE psd.is_active = true
      AND psd.embedding IS NOT NULL
      AND (1 - (psd.embedding <=> ${qvec}::vector)) >= ${SEARCH_V2_VECTOR_MIN_SIMILARITY}
    ORDER BY psd.embedding <=> ${qvec}::vector
    LIMIT ${SEARCH_V2_VECTOR_RECALL_LIMIT}
  )
`;

export type ScoredCandidate = {
  product_id: string;
  product_code: string;
  product_name: string;
  category_name: string;
  car_model_text: string;
  sim: number;
  lexical_score: number;
  trigram: number;
  stock_bonus: number;
  sales_bonus: number;
  stock: number;
  sales_count: number;
};

/**
 * Pulls the production vector-recall set with every score component split out,
 * so a caller can recompose the total under any weighting.
 */
export const fetchScoredVectorCandidates = async (
  q: QueryForms,
  qvec: string,
): Promise<ScoredCandidate[]> =>
  runInSearchTx((tx) =>
    tx.$queryRaw<ScoredCandidate[]>(Prisma.sql`
      WITH ${vectorRecallCteSql(qvec)}
      SELECT
        psd.product_id, psd.product_code, psd.product_name, psd.category_name,
        coalesce(psd.car_model_text, '') AS car_model_text,
        v.sim,
        (${lexicalScoreSql(q)})::float8 AS lexical_score,
        (${trigramScoreSql(q)})::float8 AS trigram,
        (${stockScoreSql})::float8 AS stock_bonus,
        (${salesScoreSql})::float8 AS sales_bonus,
        psd.stock::float8 AS stock,
        psd.sales_count::float8 AS sales_count
      FROM product_search_documents psd
      JOIN vec v ON v.product_id = psd.product_id
    `),
  );

/**
 * Runs a callback inside a transaction that has the same session GUCs the search
 * path pins (trigram candidate threshold + HNSW breadth). Both are required for
 * the mirrored query to admit the same rows production would.
 */
export async function runInSearchTx<T>(
  fn: (tx: PrismaTypes.TransactionClient) => Promise<T>,
): Promise<T> {
  return dbSearchTx(async (tx) => {
    await tx.$executeRaw`SELECT set_config('pg_trgm.similarity_threshold', ${SEARCH_V2_TRGM_CANDIDATE_THRESHOLD}, true)`;
    await tx.$executeRaw`SELECT set_config('hnsw.ef_search', ${HNSW_EF_SEARCH}, true)`;
    return fn(tx);
  });
}

/** Cosine similarity for in-memory vectors (used by the re-embedding experiment). */
export const cosine = (a: number[], b: number[]): number => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

/** Shorthand for logging a category without its English parenthetical. */
export const shortCategory = (categoryName: string): string => categoryName.split(" (")[0];

/** Uniform teardown for every harness script. */
export const runHarness = (main: () => Promise<void>, label: string): void => {
  main()
    .catch((error: unknown) => {
      console.error(`[${label}] failed:`, error);
      process.exitCode = 1;
    })
    .finally(() => {
      void db.$disconnect();
    });
};
