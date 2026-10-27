import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import type { Prisma } from "@/lib/generated/prisma";

// Golden suite for the two-phase ranked query and the speculative embedding
// (2026-10-27). Both are speed-only changes; these tests pin the properties that
// keep the output identical to the former single-pass query:
//  - the score is computed once per candidate (MATERIALIZED CTE), with the same
//    `score > 0` filter → COUNT(*) OVER() → ORDER BY → OFFSET/LIMIT as before;
//  - the per-row match flags are computed only for the returned page;
//  - the embedding only changes WHEN it is requested, never whether it is used.
// The row-level proof against production data is the DB golden
// scripts/test-product-search-two-phase-golden.ts.

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

type RankedRow = {
  product_id: string;
  match_code: boolean;
  match_oem: boolean;
  match_name: boolean;
  match_keyword: boolean;
  match_fitment: boolean;
  match_year: boolean;
  match_trigram_high: boolean;
  semantic_similarity: number | null;
  vector_only: boolean;
  total_count: bigint;
};

const rankedTexts: string[] = [];
const events: string[] = [];
let lexicalRows: RankedRow[] = [];
let broadRows: RankedRow[] = [];
let vectorMatches: Array<{ product_id: string; sim: number }> = [];
let embedResult: number[] | null = null;
let embedCalls = 0;
let keptAlive = 0;

const rankedRow = (id: string, total: number, overrides: Partial<RankedRow> = {}): RankedRow => ({
  product_id: id,
  match_code: false,
  match_oem: false,
  match_name: true,
  match_keyword: false,
  match_fitment: false,
  match_year: false,
  match_trigram_high: false,
  semantic_similarity: null,
  vector_only: false,
  total_count: BigInt(total),
  ...overrides,
});

const rows = (count: number): RankedRow[] =>
  Array.from({ length: count }, (_, index) => rankedRow(`p${index + 1}`, count + 40));

before(async () => {
  await mock.module("@/lib/db", {
    namedExports: {
      db: {},
      withDbRetry: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
      // Exact-match query (and the 2-digit-year evidence probe): no hits, so the
      // engine continues to the ranked stages.
      dbSearchRaw: async (): Promise<unknown[]> => {
        events.push("exact");
        return [];
      },
      dbSearchTx: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
        fn({
          $executeRaw: async (): Promise<number> => 0,
          $queryRaw: async (query: Prisma.Sql): Promise<unknown[]> => {
            if (query.text.includes("embedding <=>")) {
              events.push("vector");
              return vectorMatches;
            }
            rankedTexts.push(query.text);
            const broad = query.text.includes("trgm_text");
            events.push(broad ? "ranked-broad" : "ranked-fast");
            return broad ? broadRows : lexicalRows;
          },
        }),
    },
  });
  await mock.module("@/lib/search-synonyms", {
    namedExports: {
      expandQueryTokenGroups: async (query: string): Promise<string[][]> =>
        query.split(/\s+/).filter(Boolean).map((token) => [token]),
    },
  });
  await mock.module("@/lib/embeddings", {
    namedExports: {
      embedQuery: async (): Promise<number[] | null> => {
        embedCalls += 1;
        events.push("embed");
        return embedResult;
      },
      toPgVectorLiteral: (vector: number[]): string => `[${vector.join(",")}]`,
    },
  });
  await mock.module("@/lib/product-search-request-lifecycle", {
    namedExports: {
      runProductSearchRefreshWithRequestLifetime: <T>(factory: () => Promise<T>): Promise<T> => factory(),
      keepProductSearchTaskAlive: (): void => {
        keptAlive += 1;
      },
    },
  });
});

beforeEach(() => {
  rankedTexts.length = 0;
  events.length = 0;
  lexicalRows = [];
  broadRows = [];
  vectorMatches = [];
  embedResult = null;
  embedCalls = 0;
  keptAlive = 0;
});

const search = async (input: Record<string, unknown>) => {
  const { searchProductIdsV2 } = await import("@/lib/product-search");
  return searchProductIdsV2({ isActive: true, take: 8, ...input });
};

const sectionOf = (sql: string) => {
  const pageStart = sql.indexOf("page AS (");
  // First SELECT after the page's LIMIT (flags may hold EXISTS (SELECT …)).
  const finalSelect = sql.indexOf("SELECT", sql.indexOf("LIMIT $", pageStart));
  return {
    scored: sql.slice(0, pageStart),
    page: sql.slice(pageStart, finalSelect),
    final: sql.slice(finalSelect),
  };
};

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

const OUTPUT_COLUMNS = [
  "match_code",
  "match_oem",
  "match_name",
  "match_keyword",
  "match_fitment",
  "match_year",
  "match_trigram_high",
  "semantic_similarity",
  "vector_only",
];

test("the score is computed once per candidate inside a MATERIALIZED CTE", async () => {
  lexicalRows = rows(8);
  await search({ query: "toyota" });
  const [sql] = rankedTexts;
  assert.ok(sql, "a ranked query ran");
  assert.match(sql, /WITH\s+scored AS MATERIALIZED \(/);
  assert.equal(count(sql, "-- Exact matches"), 1, "one score expression");
  assert.equal(count(sql, ") AS score"), 1, "the score is aliased once");
  const { scored } = sectionOf(sql);
  // Fast candidate mode has no trigram probes, so the only similarity() calls
  // left in the scored CTE are the score's own four.
  assert.equal(count(scored, "similarity("), 4);
  for (const column of OUTPUT_COLUMNS) {
    assert.ok(!scored.includes(`AS ${column}`), `${column} is not computed per candidate`);
  }
});

test("the page keeps the single-pass filter → count → order → offset/limit", async () => {
  lexicalRows = rows(8);
  await search({ query: "toyota", skip: 16 });
  const { page } = sectionOf(rankedTexts[0]);
  const at = (needle: string): number => {
    const index = page.indexOf(needle);
    assert.ok(index >= 0, `page contains ${needle}`);
    return index;
  };
  const count_ = at("COUNT(*) OVER() AS total_count");
  const where = at("WHERE scored.score > 0");
  const order = at(
    "ORDER BY scored.score DESC, scored.product_created_at DESC, scored.product_id DESC",
  );
  const offset = at("OFFSET $");
  const limit = at("LIMIT $");
  assert.ok(count_ < where && where < order && order < offset && offset < limit);
});

test("match flags are computed only for the page rows, joined 1:1 by primary key", async () => {
  lexicalRows = rows(8);
  await search({ query: "toyota" });
  const { final } = sectionOf(rankedTexts[0]);
  for (const column of OUTPUT_COLUMNS) {
    assert.ok(final.includes(`AS ${column}`), `final SELECT returns ${column}`);
  }
  assert.ok(final.includes("page.total_count"));
  assert.ok(final.includes("INNER JOIN product_search_documents psd ON psd.product_id = page.product_id"));
  assert.ok(
    final.includes("ORDER BY page.score DESC, page.product_created_at DESC, page.product_id DESC"),
    "the final order repeats the page order",
  );
});

test("the result object is built from the page rows exactly as before", async () => {
  lexicalRows = [
    rankedRow("p1", 12, { match_code: true, match_name: false }),
    rankedRow("p2", 12, { match_keyword: true, match_trigram_high: true }),
    ...rows(6).map((row, index) => ({ ...row, product_id: `q${index}`, total_count: BigInt(12) })),
  ];
  const result = await search({ query: "toyota" });
  assert.deepEqual(result.ids.slice(0, 2), ["p1", "p2"]);
  assert.equal(result.ids.length, 8);
  assert.equal(result.total, 12);
  assert.deepEqual(result.matchReasons?.p1, ["code"]);
  assert.deepEqual(result.matchReasons?.p2, ["keyword", "name"]);
  assert.deepEqual(result.highTrigramProductIds, ["p2"]);
  assert.equal(result.retrievalMode, "lexical");
});

test("the semantic (vector) variant keeps the vec CTE first and joins it in both phases", async () => {
  embedResult = [0.1, 0.2];
  vectorMatches = [{ product_id: "p9", sim: 0.71 }];
  broadRows = [rankedRow("p9", 1, { semantic_similarity: 0.71, vector_only: true, match_name: false })];
  const result = await search({ query: "migty" });
  const broad = rankedTexts.find((sql) => sql.includes("vec(product_id, sim) AS (VALUES"));
  assert.ok(broad, "a vector-ranked query ran");
  assert.ok(broad.indexOf("vec(product_id, sim)") < broad.indexOf("scored AS MATERIALIZED"));
  assert.equal(count(broad, "LEFT JOIN vec v ON v.product_id = psd.product_id"), 2);
  assert.deepEqual(result.ids, ["p9"]);
  assert.deepEqual(result.vectorOnlyProductIds, ["p9"]);
  assert.equal(result.retrievalMode, "hybrid");
});

test("without the prefetch flag the embedding still waits for the lexical stage (unchanged)", async () => {
  embedResult = [0.1, 0.2];
  await search({ query: "migty" });
  assert.equal(embedCalls, 1);
  assert.ok(events.indexOf("ranked-fast") < events.indexOf("embed"));
  assert.equal(keptAlive, 0);
});

test("without the prefetch flag a sufficient lexical result never calls Gemini (unchanged)", async () => {
  lexicalRows = rows(8);
  await search({ query: "toyota" });
  assert.equal(embedCalls, 0);
});

test("prefetch starts the embedding before any DB stage and reuses it", async () => {
  embedResult = [0.1, 0.2];
  vectorMatches = [{ product_id: "p9", sim: 0.71 }];
  broadRows = [rankedRow("p9", 1, { semantic_similarity: 0.71 })];
  await search({ query: "migty", prefetchQueryEmbedding: true });
  assert.equal(events[0], "embed", "the Gemini call starts first");
  assert.equal(embedCalls, 1, "the speculative vector is reused, not requested twice");
  assert.ok(events.includes("vector"));
  assert.equal(keptAlive, 1, "the speculative task is kept alive with the request");
});

test("prefetch with a sufficient lexical result returns exactly what no-prefetch returns", async () => {
  embedResult = [0.1, 0.2];
  lexicalRows = rows(8);
  const withPrefetch = await search({ query: "toyota", prefetchQueryEmbedding: true });
  assert.equal(embedCalls, 1, "speculative call made");
  assert.ok(!events.includes("vector"), "but the vector stage did not run");
  const callsBefore = embedCalls;
  const without = await search({ query: "toyota" });
  assert.equal(embedCalls, callsBefore, "no Gemini call without the flag");
  assert.deepEqual(withPrefetch, without);
});

test("prefetch respects disableSemantic and year-only queries", async () => {
  embedResult = [0.1, 0.2];
  await search({ query: "migty", prefetchQueryEmbedding: true, disableSemantic: true });
  assert.equal(embedCalls, 0, "disableSemantic wins");
  await search({ query: "2010", prefetchQueryEmbedding: true });
  assert.equal(embedCalls, 0, "year-only queries never embed");
  assert.equal(keptAlive, 0);
});
