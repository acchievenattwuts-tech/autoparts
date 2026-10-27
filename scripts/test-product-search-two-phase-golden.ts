/**
 * DB golden: the two-phase ranked query returns exactly what the former
 * single-pass query returned (lib/product-search.ts → runRankedQuery).
 *
 * Replays real search text (ProductSearchLog plus fixed edge cases) through
 * searchProductIdsV2 in the shapes its callers use — admin dropdown, admin
 * product list (incl. page 2 and an out-of-range page), storefront search,
 * admin filters and chat-style fitment filters. Every ranked statement the
 * engine sends is captured, rebuilt in the former single-pass form (same score
 * expression, flags, candidate clause and parameters) and both run inside ONE
 * read-only REPEATABLE READ snapshot. Any difference in rows, order, totals or
 * flags fails the run.
 *
 * Read-only. Gemini (semantic recall) is off unless --semantic is passed; with
 * it, only the dropdown shape embeds, throttled to protect the shared keys.
 *
 *   npm run test:search-two-phase-golden -- [--limit=300] [--semantic]
 */
import { PrismaClient } from "@/lib/generated/prisma";
import { FluidPrismaPg } from "@/lib/db-pool";

type QueryEvent = { query: string; params: string };
type Row = Record<string, unknown>;
type SearchInput = Record<string, unknown> & { query: string };
type Shape = { name: string; build: (query: string) => SearchInput; viaRequiredTokenWrapper: boolean };

const args = process.argv.slice(2);
const LIMIT = Number(args.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? 300);
const WITH_SEMANTIC = args.includes("--semantic");
const FILTERED_SHAPE_QUERIES = 40;
const DEEP_PAGE_QUERIES = 20;
const DEEP_PAGE_SKIP = 5_000;
const STATEMENT_TIMEOUT_MS = 30_000;
const GEMINI_MIN_INTERVAL_MS = 1_500;
const MAX_REPORTED_MISMATCHES = 15;

const EDGE_QUERIES = [
  "ti", "d-", "St", "CV", "TFR", "toyota", "altis", "vigo", "d-max", "city",
  "2010", "1950", "vios 08", "คอมแอร์ vigo 2010", "หม้อน้ำ เกียร์ออโต้", "คลัช M/T",
  "P0444", "EV-1030", "88515-10010", "CV.04.011", "7122", "6129", "M16", "5/16",
  "น็อต", "สวิตช์เพรส", "น้ำยาล้างคอยเย็น", "ไส้ไดเออร์", "migty", "toger", "เบรค[",
];

// The engine's statements are captured from a client created with query events
// and installed where lib/db looks for its singleton, before lib/db loads.
const events: QueryEvent[] = [];
const client = new PrismaClient({
  adapter: new FluidPrismaPg({
    connectionString: process.env.DATABASE_URL ?? "",
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  }),
  log: [{ emit: "event", level: "query" }],
});
client.$on("query", (event) => events.push({ query: event.query, params: event.params }));
// bypassInternalCaches reloads every active synonym (~33 KB) on every search;
// load them once per run instead — each DB byte is Supabase egress.
let synonymRows: unknown = null;
const engineClient = client.$extends({
  query: {
    searchSynonym: {
      async findMany({ args, query }) {
        synonymRows ??= await query(args);
        return synonymRows as Awaited<ReturnType<typeof query>>;
      },
    },
  },
});
(globalThis as unknown as { prisma: unknown }).prisma = engineClient;

// Throttle Gemini (only reached with --semantic) so a replay never rate-limits
// the keys the chat bots share.
const originalFetch = globalThis.fetch;
let lastGeminiCallAt = 0;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  if (String(input).includes("generativelanguage.googleapis.com")) {
    const waitMs = lastGeminiCallAt + GEMINI_MIN_INTERVAL_MS - Date.now();
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastGeminiCallAt = Date.now();
  }
  return originalFetch(input, init);
};

/** Rebuilds the former single-pass ranked statement from a two-phase one. */
const toSinglePassRankedSql = (sql: string): string => {
  const scoredAt = sql.indexOf("scored AS MATERIALIZED (");
  const vecCte = sql.slice(sql.indexOf("WITH") + "WITH".length, scoredAt);
  const scoreStart = sql.indexOf("psd.product_created_at,", scoredAt) + "psd.product_created_at,".length;
  const fromAt = sql.indexOf("FROM product_search_documents psd", scoreStart);
  const scoreExpr = sql.slice(scoreStart, fromAt).trim();
  const pageAt = sql.indexOf("page AS (", fromAt);
  const fromWhere = sql.slice(fromAt, sql.lastIndexOf(")", pageAt)).trim();
  const range = sql.slice(pageAt).match(/OFFSET (\$\d+)\s+LIMIT (\$\d+)/);
  // The final SELECT is the first one after the page's LIMIT — the flags it
  // returns contain EXISTS (SELECT …) subqueries for year matches.
  const finalSelectAt = sql.indexOf("SELECT", sql.indexOf("LIMIT $", pageAt));
  const fromPageAt = sql.lastIndexOf("FROM page");
  const flags = sql
    .slice(finalSelectAt + "SELECT".length, fromPageAt)
    .trim()
    .replace(/^psd\.product_id,/, "")
    .replace(/,\s*page\.total_count\s*$/, "")
    .trim();
  if (scoredAt < 0 || fromAt < 0 || pageAt < 0 || !range || !scoreExpr.endsWith("AS score")) {
    throw new Error("Unrecognised two-phase ranked SQL shape");
  }
  return `
    WITH ${vecCte} ranked AS (
      SELECT
        psd.product_id,
        psd.product_created_at,
        ${flags},
        ${scoreExpr}
      ${fromWhere}
    )
    SELECT
      ranked.product_id, ranked.match_code, ranked.match_oem, ranked.match_name,
      ranked.match_keyword, ranked.match_fitment, ranked.match_year,
      ranked.match_trigram_high, ranked.semantic_similarity, ranked.vector_only,
      COUNT(*) OVER() AS total_count
    FROM ranked
    WHERE ranked.score > 0
    ORDER BY ranked.score DESC, ranked.product_created_at DESC, ranked.product_id DESC
    OFFSET ${range[1]}
    LIMIT ${range[2]}`;
};

const canonical = (rows: Row[]): string =>
  JSON.stringify(
    rows.map((row) =>
      Object.fromEntries(
        Object.keys(row)
          .sort()
          .map((key) => [key, typeof row[key] === "bigint" ? String(row[key]) : row[key]]),
      ),
    ),
  );

const runBothInOneSnapshot = async (
  sql: string,
  params: unknown[],
  threshold: string,
): Promise<{ current: Row[]; singlePass: Row[] }> =>
  client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe(
        `SELECT set_config('pg_trgm.similarity_threshold', '${threshold}', true),
                set_config('statement_timeout', '${STATEMENT_TIMEOUT_MS}', true)`,
      );
      const current = await tx.$queryRawUnsafe<Row[]>(sql, ...params);
      const singlePass = await tx.$queryRawUnsafe<Row[]>(toSinglePassRankedSql(sql), ...params);
      return { current, singlePass };
    },
    { isolationLevel: "RepeatableRead", timeout: STATEMENT_TIMEOUT_MS * 3, maxWait: 20_000 },
  );

const loadCorpus = async (): Promise<string[]> => {
  const logged = await client.$queryRawUnsafe<Array<{ query: string }>>(
    `SELECT min(query) AS query
       FROM "ProductSearchLog"
      WHERE length(trim(query)) >= 2
      GROUP BY lower(trim(query))
      ORDER BY sum("hitCount") DESC, max("updatedAt") DESC
      LIMIT $1`,
    LIMIT,
  );
  const seen = new Set<string>();
  return [...EDGE_QUERIES, ...logged.map((row) => row.query.trim())].filter((query) => {
    const key = query.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const loadFilterIds = async (): Promise<{
  categoryId: string;
  categoryName: string;
  carBrandId: string;
  carBrandName: string;
}> => {
  const [category] = await client.$queryRawUnsafe<Array<{ id: string; name: string }>>(
    `SELECT c.id, c.name FROM "Product" p JOIN "Category" c ON c.id = p."categoryId"
      WHERE p."isActive" GROUP BY c.id, c.name ORDER BY count(*) DESC LIMIT 1`,
  );
  const [brand] = await client.$queryRawUnsafe<Array<{ id: string; name: string }>>(
    `SELECT cb.id, cb.name FROM "ProductCarModel" pcm
       JOIN "CarModel" cm ON cm.id = pcm."carModelId"
       JOIN "CarBrand" cb ON cb.id = cm."carBrandId"
      GROUP BY cb.id, cb.name ORDER BY count(*) DESC LIMIT 1`,
  );
  return { categoryId: category.id, categoryName: category.name, carBrandId: brand.id, carBrandName: brand.name };
};

const main = async (): Promise<void> => {
  const { searchProductIdsV2, SEARCH_V2_TRGM_CANDIDATE_THRESHOLD } = await import("@/lib/product-search");
  const { runStorefrontProductSearchWithRequiredTokenFallback } = await import("@/lib/storefront-product-search");
  const { extractProductSearchRequiredTokens } = await import("@/lib/product-search-required-tokens");

  const corpus = await loadCorpus();
  const filters = await loadFilterIds();
  const isShort = (query: string): boolean => [...query].length < 4;

  const shapes: Shape[] = [
    {
      name: "admin-dropdown",
      viaRequiredTokenWrapper: true,
      build: (query) => ({
        query, isActive: true, take: 8, order: "createdAtDesc", cacheProfile: "admin",
        disableSemantic: !WITH_SEMANTIC || isShort(query), disableBroadFallback: true,
        prefetchQueryEmbedding: WITH_SEMANTIC,
      }),
    },
    ...[0, 30].map((skip): Shape => ({
      name: `admin-list-skip${skip}`,
      viaRequiredTokenWrapper: false,
      build: (query) => {
        const requiredTokens = extractProductSearchRequiredTokens(query);
        return {
          query, isActive: true, skip, take: 30, order: "codeDesc", cacheProfile: "admin",
          disableSemantic: true, ...(requiredTokens.length > 0 ? { requiredTokens } : {}),
        };
      },
    })),
    {
      name: "storefront",
      viaRequiredTokenWrapper: true,
      build: (query) => ({
        query, isActive: true, isStorefrontVisible: true, take: 24, order: "createdAtDesc",
        cacheProfile: "storefront", disableSemantic: true,
      }),
    },
  ];
  const filteredShapes: Shape[] = [
    {
      name: "admin-filters",
      viaRequiredTokenWrapper: false,
      build: (query) => ({
        query, isActive: true, take: 30, order: "codeDesc", cacheProfile: "admin", disableSemantic: true,
        categoryIds: [filters.categoryId], stockStatus: "in_stock",
      }),
    },
    {
      name: "admin-car-year",
      viaRequiredTokenWrapper: false,
      build: (query) => ({
        query, isActive: true, take: 30, order: "codeDesc", cacheProfile: "admin", disableSemantic: true,
        carBrandId: filters.carBrandId, yearMin: 2008, yearMax: 2014,
      }),
    },
    {
      name: "chat-fitment",
      viaRequiredTokenWrapper: false,
      build: (query) => ({
        query, isActive: true, isStorefrontVisible: true, take: 5, cacheProfile: "storefront",
        disableSemantic: true, categoryName: filters.categoryName, carBrandName: filters.carBrandName,
        fitmentYear: 2012,
      }),
    },
  ];
  const deepPageShape: Shape = {
    name: "admin-list-out-of-range",
    viaRequiredTokenWrapper: false,
    build: (query) => ({
      query, isActive: true, skip: DEEP_PAGE_SKIP, take: 30, order: "codeDesc", cacheProfile: "admin",
      disableSemantic: true,
    }),
  };

  const tally = new Map<string, { cases: number; statements: number; identical: number }>();
  const mismatches: string[] = [];
  const errors: string[] = [];

  for (const [index, query] of corpus.entries()) {
    const caseShapes = [
      ...shapes,
      ...(index < FILTERED_SHAPE_QUERIES ? filteredShapes : []),
      ...(index < DEEP_PAGE_QUERIES ? [deepPageShape] : []),
    ];
    for (const shape of caseShapes) {
      const stats = tally.get(shape.name) ?? { cases: 0, statements: 0, identical: 0 };
      tally.set(shape.name, stats);
      stats.cases += 1;
      events.length = 0;
      try {
        const input = shape.build(query);
        const run = (searchInput: SearchInput) =>
          searchProductIdsV2(searchInput as Parameters<typeof searchProductIdsV2>[0], {
            bypassInternalCaches: true,
          });
        if (shape.viaRequiredTokenWrapper) {
          await runStorefrontProductSearchWithRequiredTokenFallback(
            input as Parameters<typeof runStorefrontProductSearchWithRequiredTokenFallback>[0],
            (searchInput) => run(searchInput as SearchInput),
          );
        } else {
          await run(input);
        }
        const ranked = events.filter((event) => event.query.includes("scored AS MATERIALIZED"));
        for (const statement of ranked) {
          stats.statements += 1;
          const params = JSON.parse(statement.params) as unknown[];
          const { current, singlePass } = await runBothInOneSnapshot(
            statement.query,
            params,
            SEARCH_V2_TRGM_CANDIDATE_THRESHOLD,
          );
          if (canonical(current) === canonical(singlePass)) {
            stats.identical += 1;
          } else {
            mismatches.push(
              `${shape.name} ${JSON.stringify(query)}: two-phase ${current.length} rows vs single-pass ${singlePass.length}`,
            );
          }
        }
      } catch (error) {
        errors.push(`${shape.name} ${JSON.stringify(query)}: ${(error as Error).message.slice(0, 160)}`);
      }
    }
  }

  console.log(`corpus: ${corpus.length} queries (${EDGE_QUERIES.length} edge + ProductSearchLog top ${LIMIT})`);
  console.log(`semantic: ${WITH_SEMANTIC ? "on (dropdown shape)" : "off"}`);
  for (const [name, stats] of tally) {
    console.log(
      `${name.padEnd(26)} cases ${String(stats.cases).padStart(4)}  ranked statements ${String(stats.statements).padStart(5)}  identical ${stats.identical}`,
    );
  }
  const totalStatements = [...tally.values()].reduce((sum, stats) => sum + stats.statements, 0);
  console.log(`total ranked statements compared: ${totalStatements}, mismatches: ${mismatches.length}, errors: ${errors.length}`);
  for (const line of mismatches.slice(0, MAX_REPORTED_MISMATCHES)) console.log(`  MISMATCH ${line}`);
  for (const line of errors.slice(0, MAX_REPORTED_MISMATCHES)) console.log(`  ERROR ${line}`);
  await client.$disconnect();
  if (mismatches.length > 0 || errors.length > 0 || totalStatements === 0) process.exit(1);
};

main().catch(async (error) => {
  console.error(error);
  await client.$disconnect();
  process.exit(1);
});
