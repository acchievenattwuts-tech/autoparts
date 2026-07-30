/**
 * Backfills semantic embeddings into product_search_documents.embedding for the
 * hybrid search (Phase 1). Idempotent: only embeds rows where embedding IS NULL
 * (pass --all to re-embed everything, e.g. after changing the embedding model).
 *
 *   npm run backfill:embeddings          # only missing
 *   npm run backfill:embeddings -- --all # re-embed all rows
 *
 * Embeds in batches via the multi-key Gemini client; a failed batch is logged and
 * skipped (re-run later to pick it up) so one transient error never aborts the run.
 */
import { db } from "@/lib/db";
import {
  buildProductEmbeddingSourceHash,
  buildProductEmbeddingText,
  embedTexts,
  getProductEmbeddingModelId,
  toPgVectorLiteral,
} from "@/lib/embeddings";

const BATCH_SIZE = 50;

type PsdRow = {
  product_id: string;
  product_name: string;
  category_name: string;
  brand_name: string;
  car_brand_text: string;
  car_model_text: string;
  fitment_text: string;
  keyword_text: string;
  has_embedding: boolean;
  embedding_model: string | null;
  embedding_source_hash: string | null;
};

async function main(): Promise<void> {
  const reembedAll = process.argv.includes("--all");

  const allRows = await db.$queryRaw<PsdRow[]>`
    SELECT product_id, product_name, category_name, brand_name,
           car_brand_text, car_model_text, fitment_text, keyword_text,
           (embedding IS NOT NULL) AS has_embedding,
           embedding_model, embedding_source_hash
    FROM product_search_documents
    ORDER BY product_id
  `;
  const modelId = getProductEmbeddingModelId();
  const preparedRows = allRows.map((row) => {
    const text = buildProductEmbeddingText({
      productName: row.product_name,
      categoryName: row.category_name,
      brandName: row.brand_name,
      carText: `${row.car_brand_text} ${row.car_model_text}`.trim(),
      fitmentText: row.fitment_text,
      keywordText: row.keyword_text,
    });
    return { row, text, sourceHash: buildProductEmbeddingSourceHash(text) };
  });
  const rows = preparedRows.filter(({ row, sourceHash }) =>
    reembedAll ||
    !row.has_embedding ||
    row.embedding_model !== modelId ||
    row.embedding_source_hash !== sourceHash,
  );

  console.log(`[backfill-embeddings] ${rows.length} row(s) to embed (mode=${reembedAll ? "all" : "stale-or-missing"})`);
  if (rows.length === 0) return;

  let done = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const texts = batch.map(({ text }) => text);

    try {
      const vectors = await embedTexts(texts);
      if (vectors.length !== batch.length) throw new Error("vector count mismatch");

      await db.$transaction(
        batch.map(({ row, sourceHash }, idx) =>
          db.$executeRaw`
            UPDATE product_search_documents
            SET embedding = ${toPgVectorLiteral(vectors[idx])}::vector,
                embedding_model = ${modelId},
                embedding_source_hash = ${sourceHash},
                embedded_at = now(),
                updated_at = now()
            WHERE product_id = ${row.product_id}
          `,
        ),
      );
      done += batch.length;
      console.log(`[backfill-embeddings] embedded ${done}/${rows.length}`);
    } catch (error) {
      failed += batch.length;
      console.error(
        `[backfill-embeddings] batch ${i / BATCH_SIZE + 1} failed (will remain NULL, re-run to retry):`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  console.log(`[backfill-embeddings] done. embedded=${done} failed=${failed}`);
}

main()
  .catch((error) => {
    console.error("[backfill-embeddings] fatal:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void db.$disconnect();
  });
