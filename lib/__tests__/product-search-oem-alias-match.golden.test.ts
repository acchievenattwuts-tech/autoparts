import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { before, beforeEach, mock } from "node:test";

import type { Prisma } from "@/lib/generated/prisma";

// Golden suite for the OEM match (2026-10-27). The former whitespace-token regex
// over `oem_text` never worked: its `\s` was written inside a JS template
// literal, so Postgres received "(^|s)…($|s)" — "14" matched compressor "5s14",
// "tor" matched "thermistor", and those wrong hits took the exact-match
// shortcut. Fixing the regex literally would have matched words inside
// multi-word cross-references, collapsing car-model searches ("vigo" 51 → 1).
// The owner chose option ค: an OEM / PART_NO / CROSS_REF alias equal to the
// whole query ranks the product (+1400) and sets the "oem" reason, and OEM
// numbers are no longer an exact-match shortcut.

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

type Captured = { text: string; values: unknown[] };

const exactCalls: Captured[] = [];
const rankedCalls: Captured[] = [];
let exactRows: Array<Record<string, unknown>> = [];
let rankedRows: Array<Record<string, unknown>> = [];

before(async () => {
  await mock.module("@/lib/db", {
    namedExports: {
      db: {},
      withDbRetry: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
      dbSearchRaw: async (query: Prisma.Sql): Promise<unknown[]> => {
        if (query.text.includes("exact_matches")) {
          exactCalls.push({ text: query.text, values: query.values });
          return exactRows;
        }
        return [];
      },
      dbSearchTx: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
        fn({
          $executeRaw: async (): Promise<number> => 0,
          $queryRaw: async (query: Prisma.Sql): Promise<unknown[]> => {
            rankedCalls.push({ text: query.text, values: query.values });
            return rankedRows;
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
      embedQuery: async (): Promise<null> => null,
      toPgVectorLiteral: (vector: number[]): string => `[${vector.join(",")}]`,
    },
  });
  await mock.module("@/lib/product-search-request-lifecycle", {
    namedExports: {
      runProductSearchRefreshWithRequestLifetime: <T>(factory: () => Promise<T>): Promise<T> => factory(),
      keepProductSearchTaskAlive: (): void => {},
    },
  });
});

beforeEach(() => {
  exactCalls.length = 0;
  rankedCalls.length = 0;
  exactRows = [];
  rankedRows = [];
});

const search = async (query: string) => {
  const { searchProductIdsV2 } = await import("@/lib/product-search");
  return searchProductIdsV2({ query, isActive: true, take: 8, disableSemantic: true });
};

const ALIAS_MATCH = [
  "psd.product_id IN (",
  'SELECT pa."productId"',
  'FROM "ProductAlias" pa',
  "WHERE pa.kind IN ('OEM', 'PART_NO', 'CROSS_REF')",
  "AND f_unaccent(lower(regexp_replace(btrim(pa.alias), '[[:space:]]+', ' ', 'g')))",
];

const INDEX_FILE = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20261027_product_alias_oem_norm_index",
  "indexes",
  "01.sql",
);

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

test("no search statement uses the broken whitespace-token regex any more", async () => {
  await search("88515-10010");
  for (const { text } of [...exactCalls, ...rankedCalls]) {
    assert.ok(!text.includes("(^|s)"), "no '(^|s)' boundary");
    assert.ok(!text.includes("(^|\\s)"), "no backslash-s boundary either");
    assert.ok(!/oem_text\)\) ~/.test(text), "oem_text is never regex-matched");
  }
});

test("OEM numbers are no longer an exact-match shortcut (code, else name only)", async () => {
  await search("88515-10010");
  const [exact] = exactCalls;
  assert.ok(exact, "the exact-match query ran");
  assert.ok(!exact.text.includes("ProductAlias"), "no alias lookup in the shortcut");
  assert.ok(!exact.text.includes("oem_text"), "no oem_text in the shortcut");
  assert.ok(!exact.text.includes("match_oem"), "the shortcut has no OEM flag");
  assert.match(exact.text, /bool_or\(COALESCE\(match_code, false\)\) OVER\(\) AS has_code/);
});

test("an alias equal to the whole query adds 1400 and sets the oem flag", async () => {
  await search("88515-10010");
  const [ranked] = rankedCalls;
  assert.ok(ranked, "the ranked query ran");
  for (const fragment of ALIAS_MATCH) {
    assert.ok(ranked.text.includes(fragment), `alias match contains: ${fragment}`);
  }
  assert.match(
    ranked.text,
    /CASE WHEN\s+psd\.product_id IN \(\s*SELECT pa\."productId"\s*FROM "ProductAlias" pa[\s\S]*?\)\s*THEN 1400 ELSE 0 END/,
  );
  assert.match(
    ranked.text,
    /\(\s*psd\.product_id IN \(\s*SELECT pa\."productId"\s*FROM "ProductAlias" pa[\s\S]*?\)\s*OR f_unaccent\(lower\(psd\.oem_text\)\) LIKE f_unaccent\(lower\(\$\d+\)\)\) AS match_oem/,
    "the oem flag is the alias match OR the existing contains match",
  );
  // Score once in `scored`, flag once in the final SELECT (two-phase shape).
  assert.equal(count(ranked.text, 'FROM "ProductAlias" pa'), 2);
  // Uncorrelated, so Postgres resolves it once per statement via the index.
  assert.ok(!ranked.text.includes('pa."productId" = psd.product_id'), "the alias lookup is not correlated");
});

test("the alias lookup stays byte-for-byte equal to ProductAlias_oem_alias_norm_idx", async () => {
  const indexSql = fs.readFileSync(INDEX_FILE, "utf8");
  const expression = indexSql.match(/\(\((f_unaccent\(.*\))\)\)\s*\n/)?.[1];
  const kinds = indexSql.match(/WHERE kind IN (\([^)]*\))/)?.[1];
  assert.ok(expression && kinds, "the index file defines an expression and a kind list");
  await search("88515-10010");
  const [ranked] = rankedCalls;
  assert.ok(
    ranked.text.includes(expression.replace("btrim(alias)", "btrim(pa.alias)")),
    "same normalised expression as the index",
  );
  assert.ok(ranked.text.includes(`pa.kind IN ${kinds}`), "same kind list as the partial index");
});

test("the alias comparison is plain equality on the bound query", async () => {
  await search("เบรค[");
  const [ranked] = rankedCalls;
  assert.ok(ranked.values.includes("เบรค["), "the query is a bound parameter");
  assert.ok(!/ ~ /.test(ranked.text), "no regex operator is applied to the query");
});

test("exact product-code hits keep their former reasons (unchanged)", async () => {
  exactRows = [{ product_id: "p1", match_code: true, match_name: false, total_count: BigInt(1) }];
  const result = await search("P0444");
  assert.equal(result.retrievalMode, "exact");
  assert.deepEqual(result.ids, ["p1"]);
  assert.deepEqual(result.matchReasons?.p1, ["code", "oem"]);
  assert.equal(rankedCalls.length, 0, "the ranked query is skipped");
});

test("an exact name hit still shortcuts when no code matches (unchanged)", async () => {
  exactRows = [{ product_id: "p2", match_code: false, match_name: true, total_count: BigInt(1) }];
  const result = await search("หม้อน้ำ vigo");
  assert.equal(result.retrievalMode, "exact");
  assert.deepEqual(result.matchReasons?.p2, ["name"]);
});

test("the ranked path reports the oem reason from the flag", async () => {
  rankedRows = [
    {
      product_id: "p3",
      match_code: false,
      match_oem: true,
      match_name: false,
      match_keyword: false,
      match_fitment: false,
      match_year: false,
      match_trigram_high: false,
      semantic_similarity: null,
      vector_only: false,
      total_count: BigInt(1),
    },
  ];
  const result = await search("88515-10010");
  assert.deepEqual(result.ids, ["p3"]);
  assert.deepEqual(result.matchReasons?.p3, ["oem"]);
});
