import { Pool } from "pg";
import { detectAdminOnlyKnowledgeTopic } from "../../lib/chat-core/admin-only-knowledge";
import { isKnowledgeRagHumanOnlyQuestion } from "../../lib/chat-core/knowledge-rag";
import {
  embedKnowledgeQuery,
  getKnowledgeEmbeddingModelId,
  toKnowledgePgVectorLiteral,
} from "../../lib/knowledge-embeddings";
import {
  getProductionKnowledgeRetrievalPolicy,
  KNOWLEDGE_RAG_BLOCKED_SOURCE_REFS,
  KNOWLEDGE_RAG_RETRIEVAL_LATENCY_BUDGET_MS,
  type KnowledgeRetrievalPolicy,
} from "../../lib/knowledge-rag-retrieval-policy";
import {
  knowledgeAdminOnlyGoldenCases,
  knowledgeHardNegativeGoldenCases,
  knowledgeRetrievalGoldenCases,
} from "./knowledge-rag-golden-cases";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to check Knowledge RAG.");

type RankedRow = {
  id: string;
  source_ref: string;
  semantic_score: number;
  lexical_score: number;
  title_score: number;
  section_score: number;
  hybrid_score: number;
};

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

async function retrieve(
  pool: Pool,
  question: string,
  vector: number[],
  policy: KnowledgeRetrievalPolicy,
): Promise<RankedRow[]> {
  const rows = await pool.query<RankedRow>(
    `WITH scored AS (
       SELECT id, source_ref,
         GREATEST(0, 1 - (embedding <=> $1::vector))::double precision AS semantic_score,
         GREATEST(
           similarity(f_unaccent(lower(search_text)), f_unaccent(lower($2))),
           ts_rank_cd(search_document, plainto_tsquery('simple', f_unaccent($2)))
         )::double precision AS lexical_score,
         similarity(f_unaccent(lower(title)), f_unaccent(lower($2)))::double precision AS title_score,
         similarity(f_unaccent(lower(section_heading)), f_unaccent(lower($2)))::double precision AS section_score
       FROM knowledge_documents
       WHERE status='APPROVED'
         AND embedding IS NOT NULL
         AND embedding_model=$3
         AND NOT (source_ref = ANY($4::text[]))
         AND (valid_until IS NULL OR valid_until > now())
     )
     SELECT *, (
       semantic_score * $5 +
       LEAST(lexical_score, 1) * $6 +
       LEAST(title_score, 1) * $7 +
       LEAST(section_score, 1) * $8
     )::double precision AS hybrid_score
     FROM scored
     WHERE semantic_score >= $9
     ORDER BY hybrid_score DESC
     LIMIT $10`,
    [
      toKnowledgePgVectorLiteral(vector),
      question,
      getKnowledgeEmbeddingModelId(),
      [...KNOWLEDGE_RAG_BLOCKED_SOURCE_REFS],
      policy.semanticWeight,
      policy.lexicalWeight,
      policy.titleWeight,
      policy.sectionWeight,
      policy.minSemantic,
      policy.topK,
    ],
  );
  return rows.rows.filter((row) => Number(row.hybrid_score) >= policy.minHybrid);
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  const policy = getProductionKnowledgeRetrievalPolicy();
  let retrievalPassed = 0;
  let baselinePassed = 0;
  let paraphrasePassed = 0;
  let adminOnlyPassed = 0;
  let hardNegativePassed = 0;
  const failures: string[] = [];
  const retrievalLatencies: number[] = [];

  try {
    const health = await pool.query<{
      approved: number;
      embedded: number;
      model: string | null;
    }>(`
      SELECT
        count(*) FILTER (WHERE status='APPROVED')::int AS approved,
        count(*) FILTER (WHERE status='APPROVED' AND embedding IS NOT NULL)::int AS embedded,
        max(embedding_model) FILTER (WHERE status='APPROVED') AS model
      FROM knowledge_documents
    `);
    console.log("health", health.rows[0]);
    if (
      !health.rows[0] ||
      health.rows[0].approved === 0 ||
      health.rows[0].approved !== health.rows[0].embedded ||
      health.rows[0].model !== getKnowledgeEmbeddingModelId()
    ) {
      throw new Error("KNOWLEDGE_RAG_HEALTH_CHECK_FAILED");
    }

    const productModels = await pool.query<{ embedding_model: string; count: number }>(`
      SELECT embedding_model, count(*)::int AS count
      FROM product_search_documents
      WHERE embedding IS NOT NULL
      GROUP BY embedding_model
      ORDER BY embedding_model
    `);
    console.log("product embedding models", productModels.rows);
    if (productModels.rows.some((row) => row.embedding_model === getKnowledgeEmbeddingModelId())) {
      throw new Error("KNOWLEDGE_MODEL_LEAKED_INTO_PRODUCT_INDEX");
    }

    const syncState = await pool.query<{
      lease_until: Date | null;
      last_success_at: Date | null;
      last_error: string | null;
      run_count: number;
    }>(`
      SELECT lease_until, last_success_at, last_error, run_count
      FROM knowledge_sync_state WHERE id='approved-corpus'
    `);
    console.log("automatic sync state", syncState.rows[0] ?? null);
    if (syncState.rows[0]?.last_error) throw new Error("KNOWLEDGE_AUTO_SYNC_LAST_RUN_FAILED");

    for (const golden of knowledgeAdminOnlyGoldenCases) {
      const actual = detectAdminOnlyKnowledgeTopic(golden.question);
      if (actual === golden.expectedTopic) {
        adminOnlyPassed += 1;
      } else {
        failures.push(
          `ADMIN_ONLY: ${golden.question} expected=${golden.expectedTopic} actual=${actual ?? "none"}`,
        );
      }
    }

    for (const golden of knowledgeRetrievalGoldenCases) {
      const startedAt = Date.now();
      const vector = await embedKnowledgeQuery(golden.question);
      if (!vector) {
        failures.push(`RETRIEVAL: ${golden.question} embedding failed`);
        continue;
      }
      const rows = await retrieve(pool, golden.question, vector, policy);
      retrievalLatencies.push(Date.now() - startedAt);
      const matched = rows.some((row) =>
        golden.expectedSourceRefs.includes(row.source_ref),
      );
      if (matched) {
        retrievalPassed += 1;
        if (golden.group === "baseline") baselinePassed += 1;
        else paraphrasePassed += 1;
      } else {
        failures.push(
          `RETRIEVAL: ${golden.question} expected=${golden.expectedSourceRefs.join("|")} actual=${rows.map((row) => row.source_ref).join("|") || "none"}`,
        );
      }
      console.log(`\n${matched ? "PASS" : "FAIL"} ${golden.question}`);
      rows.forEach((row) => {
        console.log(
          `${row.source_ref}/${row.id} semantic=${Number(row.semantic_score).toFixed(3)} lexical=${Number(row.lexical_score).toFixed(3)} hybrid=${Number(row.hybrid_score).toFixed(3)}`,
        );
      });
    }

    for (const golden of knowledgeHardNegativeGoldenCases) {
      let passed = false;
      if (golden.expected === "HUMAN_ONLY") {
        passed = isKnowledgeRagHumanOnlyQuestion(golden.question);
      } else {
        const startedAt = Date.now();
        const vector = await embedKnowledgeQuery(golden.question);
        if (vector) {
          const rows = await retrieve(pool, golden.question, vector, policy);
          retrievalLatencies.push(Date.now() - startedAt);
          passed = rows.length === 0;
          if (!passed) {
            failures.push(
              `HARD_NEGATIVE: ${golden.question} expected=no retrieval actual=${rows.map((row) => row.source_ref).join("|")}`,
            );
          }
        }
      }
      if (passed) hardNegativePassed += 1;
      else if (golden.expected === "HUMAN_ONLY") {
        failures.push(`HARD_NEGATIVE: ${golden.question} expected=human-only`);
      }
    }

    retrievalLatencies.sort((a, b) => a - b);
    const p95LatencyMs = percentile(retrievalLatencies, 0.95);
    if (p95LatencyMs > KNOWLEDGE_RAG_RETRIEVAL_LATENCY_BUDGET_MS) {
      failures.push(
        `LATENCY: p95=${p95LatencyMs}ms budget=${KNOWLEDGE_RAG_RETRIEVAL_LATENCY_BUDGET_MS}ms`,
      );
    }

    console.log("\nKnowledge RAG golden summary", {
      retrieval: `${retrievalPassed}/${knowledgeRetrievalGoldenCases.length}`,
      baseline: `${baselinePassed}/${knowledgeRetrievalGoldenCases.filter((item) => item.group === "baseline").length}`,
      paraphrase: `${paraphrasePassed}/${knowledgeRetrievalGoldenCases.filter((item) => item.group === "paraphrase").length}`,
      adminOnly: `${adminOnlyPassed}/${knowledgeAdminOnlyGoldenCases.length}`,
      hardNegative: `${hardNegativePassed}/${knowledgeHardNegativeGoldenCases.length}`,
      retrievalP95Ms: p95LatencyMs,
      latencyBudgetMs: KNOWLEDGE_RAG_RETRIEVAL_LATENCY_BUDGET_MS,
      policy,
      failures: failures.length,
    });
    if (failures.length > 0) {
      failures.forEach((failure) => console.error(failure));
      throw new Error("KNOWLEDGE_RAG_GOLDEN_FAILED");
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
