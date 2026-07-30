import { Pool } from "pg";
import { detectAdminOnlyKnowledgeTopic } from "../../lib/chat-core/admin-only-knowledge";
import {
  embedKnowledgeQuery,
  getKnowledgeEmbeddingModelId,
  toKnowledgePgVectorLiteral,
} from "../../lib/knowledge-embeddings";
import {
  knowledgeAdminOnlyGoldenCases,
  knowledgeRetrievalGoldenCases,
} from "./knowledge-rag-golden-cases";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to check Knowledge RAG.");

type RankedRow = {
  id: string;
  source_ref: string;
  semantic_score: number;
  lexical_score: number;
  hybrid_score: number;
};

async function main(): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  let retrievalPassed = 0;
  let adminOnlyPassed = 0;
  const failures: string[] = [];

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
      const vector = await embedKnowledgeQuery(golden.question);
      if (!vector) {
        failures.push(`RETRIEVAL: ${golden.question} embedding failed`);
        continue;
      }
      const rows = await pool.query<RankedRow>(
        `WITH scored AS (
           SELECT id, source_ref,
             GREATEST(0, 1 - (embedding <=> $1::vector))::double precision AS semantic_score,
             GREATEST(
               similarity(f_unaccent(lower(search_text)), f_unaccent(lower($2))),
               ts_rank_cd(search_document, plainto_tsquery('simple', f_unaccent($2)))
             )::double precision AS lexical_score
           FROM knowledge_documents
           WHERE status='APPROVED'
             AND embedding IS NOT NULL
             AND embedding_model=$3
             AND source_ref NOT IN (
               'policy:return-warranty',
               'return-warranty-policy',
               'faq:storefront:6',
               'faq:storefront:7'
             )
             AND (valid_until IS NULL OR valid_until > now())
         )
         SELECT *, (semantic_score * 0.8 + LEAST(lexical_score, 1) * 0.2)::double precision AS hybrid_score
         FROM scored
         WHERE semantic_score >= 0.55
         ORDER BY hybrid_score DESC
         LIMIT 5`,
        [
          toKnowledgePgVectorLiteral(vector),
          golden.question,
          getKnowledgeEmbeddingModelId(),
        ],
      );
      const matched = rows.rows.some((row) =>
        golden.expectedSourceRefs.includes(row.source_ref),
      );
      if (matched) {
        retrievalPassed += 1;
      } else {
        failures.push(
          `RETRIEVAL: ${golden.question} expected=${golden.expectedSourceRefs.join("|")} actual=${rows.rows.map((row) => row.source_ref).join("|") || "none"}`,
        );
      }
      console.log(`\n${matched ? "PASS" : "FAIL"} ${golden.question}`);
      rows.rows.forEach((row) => {
        console.log(
          `${row.source_ref}/${row.id} semantic=${Number(row.semantic_score).toFixed(3)} lexical=${Number(row.lexical_score).toFixed(3)} hybrid=${Number(row.hybrid_score).toFixed(3)}`,
        );
      });
    }

    console.log("\nKnowledge RAG golden summary", {
      retrieval: `${retrievalPassed}/${knowledgeRetrievalGoldenCases.length}`,
      adminOnly: `${adminOnlyPassed}/${knowledgeAdminOnlyGoldenCases.length}`,
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
