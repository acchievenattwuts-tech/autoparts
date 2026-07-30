import { Pool } from "pg";
import {
  embedKnowledgeQuery,
  getKnowledgeEmbeddingModelId,
  toKnowledgePgVectorLiteral,
} from "../../lib/knowledge-embeddings";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to check Knowledge RAG.");

const goldenQueries = [
  "ส่งต่างจังหวัดไหม",
  "ถ้าไม่รู้รหัสอะไหล่ต้องส่งข้อมูลอะไร",
  "ขอคืนสินค้าได้ภายในกี่วัน",
  "สินค้าเสียหายจากขนส่งต้องเตรียมอะไร",
  "เช็กรหัส OEM ตรงไหน",
  "คอมแอร์ตัวนี้ราคาเท่าไร มีของไหม",
  "รับเก็บเงินปลายทางไหม",
];

async function main(): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
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

    for (const question of goldenQueries) {
      const vector = await embedKnowledgeQuery(question);
      if (!vector) throw new Error(`KNOWLEDGE_QUERY_EMBED_FAILED:${question}`);
      const rows = await pool.query<{
        id: string;
        semantic_score: number;
        lexical_score: number;
        hybrid_score: number;
      }>(
        `WITH scored AS (
           SELECT id,
             GREATEST(0, 1 - (embedding <=> $1::vector))::double precision AS semantic_score,
             GREATEST(
               similarity(f_unaccent(lower(search_text)), f_unaccent(lower($2))),
               ts_rank_cd(search_document, plainto_tsquery('simple', f_unaccent($2)))
             )::double precision AS lexical_score
           FROM knowledge_documents
           WHERE status='APPROVED' AND embedding IS NOT NULL AND embedding_model=$3
         )
         SELECT *, (semantic_score * 0.8 + LEAST(lexical_score, 1) * 0.2)::double precision AS hybrid_score
         FROM scored ORDER BY hybrid_score DESC LIMIT 3`,
        [toKnowledgePgVectorLiteral(vector), question, getKnowledgeEmbeddingModelId()],
      );
      console.log(`\n${question}`);
      for (const row of rows.rows) {
        console.log(
          `${row.id} semantic=${Number(row.semantic_score).toFixed(3)} lexical=${Number(row.lexical_score).toFixed(3)} hybrid=${Number(row.hybrid_score).toFixed(3)}`,
        );
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
