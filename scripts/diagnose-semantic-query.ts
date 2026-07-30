/**
 * Single-query diagnostic for hybrid semantic search.
 *
 * Answers "why did THIS query return THAT page?" in one shot:
 *   1. A/B — the live page with semantic on vs `disableSemantic:true`
 *   2. similarity distribution — how many products clear each threshold, and the
 *      catalog-wide max (the safety margin that keeps non-product questions empty)
 *   3. nearest neighbours by raw cosine, with category
 *   4. score breakdown per vector candidate — trigram + stock + sales + sim×weight
 *
 * Read-only. Costs one Gemini query-embedding.
 *
 *   npm run diagnose:semantic-query -- "ตัวทำความเย็นแอร์วีออส"
 */
import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma";
import { embedQuery, toPgVectorLiteral } from "@/lib/embeddings";
import { normalizeSearchText } from "@/lib/search-normalization";
import { searchProductIdsV2 } from "@/lib/product-search";
import {
  buildQueryForms,
  fetchScoredVectorCandidates,
  runHarness,
  shortCategory,
  SEARCH_V2_VECTOR_MIN_SIMILARITY,
  SEARCH_V2_VECTOR_RECALL_LIMIT,
  SEARCH_V2_VECTOR_WEIGHT,
} from "./semantic-eval-core";

const DEFAULT_QUERY = "ตัวทำความเย็นแอร์วีออส";
const PAGE_SIZE = 5;
const NEIGHBOUR_SAMPLE = 12;

type ThresholdRow = {
  max_sim: number | null;
  at_floor: bigint;
  at_65: bigint;
  at_68: bigint;
  at_70: bigint;
};

type NeighbourRow = {
  product_code: string;
  product_name: string;
  category_name: string;
  sim: number;
};

const printLivePage = async (query: string, disableSemantic: boolean): Promise<void> => {
  const startedAt = performance.now();
  const result = await searchProductIdsV2(
    { query, isActive: true, skip: 0, take: PAGE_SIZE, cacheProfile: "admin", disableSemantic },
    { bypassInternalCaches: true },
  );
  const elapsedMs = Math.round(performance.now() - startedAt);
  const products = await db.product.findMany({
    where: { id: { in: result.ids } },
    select: { id: true, code: true, name: true, category: { select: { name: true } } },
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  const vectorOnly = new Set(result.vectorOnlyProductIds ?? []);
  console.log(
    `  ${disableSemantic ? "lexical only " : "semantic on  "} mode=${result.retrievalMode}` +
      ` total=${result.total} broadFallback=${result.usedBroadFallback ?? false}` +
      ` vectorOnly=${vectorOnly.size} ${elapsedMs}ms`,
  );
  for (const id of result.ids) {
    const product = byId.get(id);
    if (!product) continue;
    const sim = result.semanticSimilarities?.[id];
    console.log(
      `      ${vectorOnly.has(id) ? "V" : " "} sim=${sim === undefined ? "  -  " : sim.toFixed(3)}` +
        ` [${shortCategory(product.category?.name ?? "-")}] ${product.code} ${product.name.slice(0, 48)}`,
    );
  }
};

async function main(): Promise<void> {
  const query = process.argv.slice(2).join(" ").trim() || DEFAULT_QUERY;
  const normalized = normalizeSearchText(query);
  if (!normalized) {
    console.error("[diagnose-semantic-query] query normalised to empty string");
    process.exitCode = 1;
    return;
  }
  const forms = buildQueryForms(normalized);
  console.log(`=== query: "${query}"  (normalised: "${normalized}")`);

  console.log("\n[1] live A/B");
  await printLivePage(query, false);
  await printLivePage(query, true);

  const queryVector = await embedQuery(normalized, { bypassCache: true });
  if (!queryVector) {
    console.log(
      "\n[2] semantic disabled or embedding failed — nothing further to diagnose." +
        " Check PRODUCT_SEARCH_SEMANTIC and the Gemini keys.",
    );
    return;
  }
  const qvec = toPgVectorLiteral(queryVector);

  const [distribution] = await db.$queryRaw<ThresholdRow[]>(Prisma.sql`
    SELECT max(1 - (embedding <=> ${qvec}::vector))::float8 AS max_sim,
           count(*) FILTER (WHERE 1 - (embedding <=> ${qvec}::vector) >= ${SEARCH_V2_VECTOR_MIN_SIMILARITY}) AS at_floor,
           count(*) FILTER (WHERE 1 - (embedding <=> ${qvec}::vector) >= 0.65) AS at_65,
           count(*) FILTER (WHERE 1 - (embedding <=> ${qvec}::vector) >= 0.68) AS at_68,
           count(*) FILTER (WHERE 1 - (embedding <=> ${qvec}::vector) >= 0.70) AS at_70
    FROM product_search_documents
    WHERE embedding IS NOT NULL
  `);
  console.log(
    `\n[2] similarity distribution (dims=${queryVector.length})` +
      `\n    maxSim=${distribution?.max_sim?.toFixed(3) ?? "-"}` +
      ` | >=floor(${SEARCH_V2_VECTOR_MIN_SIMILARITY}): ${Number(distribution?.at_floor ?? 0)}` +
      ` | >=0.65: ${Number(distribution?.at_65 ?? 0)}` +
      ` | >=0.68: ${Number(distribution?.at_68 ?? 0)}` +
      ` | >=0.70: ${Number(distribution?.at_70 ?? 0)}` +
      `\n    (recall is additionally capped at LIMIT ${SEARCH_V2_VECTOR_RECALL_LIMIT} — when the` +
      ` count above far exceeds that cap, the LIMIT is what filters relevance, not the floor)`,
  );

  const neighbours = await db.$queryRaw<NeighbourRow[]>(Prisma.sql`
    SELECT product_code, product_name, category_name,
           (1 - (embedding <=> ${qvec}::vector))::float8 AS sim
    FROM product_search_documents
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${qvec}::vector
    LIMIT ${NEIGHBOUR_SAMPLE}
  `);
  console.log(`\n[3] nearest ${NEIGHBOUR_SAMPLE} by raw cosine (ignores every lexical signal)`);
  for (const row of neighbours) {
    console.log(
      `    ${row.sim.toFixed(3)}  [${shortCategory(row.category_name)}] ${row.product_code} ${row.product_name.slice(0, 52)}`,
    );
  }

  const candidates = await fetchScoredVectorCandidates(forms, qvec);
  const scored = candidates
    .map((candidate) => ({
      candidate,
      total:
        candidate.lexical_score +
        candidate.trigram +
        candidate.stock_bonus +
        candidate.sales_bonus +
        candidate.sim * SEARCH_V2_VECTOR_WEIGHT,
    }))
    .sort((left, right) => right.total - left.total);
  console.log(
    `\n[4] score breakdown for the ${candidates.length} recalled candidates` +
      `\n    total = lexical + trigram + stock + sales + sim*${SEARCH_V2_VECTOR_WEIGHT}`,
  );
  for (const { candidate, total } of scored) {
    console.log(
      `    ${total.toFixed(0).padStart(5)} = ${candidate.lexical_score.toFixed(0).padStart(4)}` +
        ` + ${candidate.trigram.toFixed(0).padStart(3)}` +
        ` + ${candidate.stock_bonus.toFixed(0).padStart(2)}` +
        ` + ${candidate.sales_bonus.toFixed(0).padStart(3)}` +
        ` + ${(candidate.sim * SEARCH_V2_VECTOR_WEIGHT).toFixed(0)}` +
        `  sim=${candidate.sim.toFixed(3)} stock=${candidate.stock} sold=${candidate.sales_count}` +
        `  [${shortCategory(candidate.category_name)}] ${candidate.product_code} ${candidate.product_name.slice(0, 40)}`,
    );
  }
}

runHarness(main, "diagnose-semantic-query");
