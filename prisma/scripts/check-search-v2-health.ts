import { db } from "@/lib/db";
import {
  buildProductEmbeddingSourceHash,
  buildProductEmbeddingText,
  getProductEmbeddingModelId,
} from "@/lib/embeddings";

type ExtensionRow = { extname: string; extversion: string };
type IndexRow = { indexname: string };
type SearchDocumentRow = {
  product_id: string;
  product_name: string;
  category_name: string;
  brand_name: string;
  car_brand_text: string;
  car_model_text: string;
  fitment_text: string;
  keyword_text: string;
  has_embedding: boolean;
  embedding_dimensions: number | null;
  embedding_model: string | null;
  embedding_source_hash: string | null;
};

async function main(): Promise<void> {
  const [extensions, indexes, rows] = await Promise.all([
    db.$queryRaw<ExtensionRow[]>`
      SELECT extname, extversion
      FROM pg_extension
      WHERE extname IN ('vector', 'pg_trgm', 'unaccent')
      ORDER BY extname
    `,
    db.$queryRaw<IndexRow[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'product_search_documents'
    `,
    db.$queryRaw<SearchDocumentRow[]>`
      SELECT product_id, product_name, category_name, brand_name,
             car_brand_text, car_model_text, fitment_text, keyword_text,
             embedding IS NOT NULL AS has_embedding,
             CASE WHEN embedding IS NULL THEN NULL ELSE vector_dims(embedding) END AS embedding_dimensions,
             embedding_model, embedding_source_hash
      FROM product_search_documents
    `,
  ]);

  const modelId = getProductEmbeddingModelId();
  const missing = rows.filter((row) => !row.has_embedding);
  const wrongDimensions = rows.filter(
    (row) => row.has_embedding && row.embedding_dimensions !== 768,
  );
  const stale = rows.filter((row) => {
    if (!row.has_embedding || row.embedding_model !== modelId) return true;
    const text = buildProductEmbeddingText({
      productName: row.product_name,
      categoryName: row.category_name,
      brandName: row.brand_name,
      carText: `${row.car_brand_text} ${row.car_model_text}`.trim(),
      fitmentText: row.fitment_text,
      keywordText: row.keyword_text,
    });
    return row.embedding_source_hash !== buildProductEmbeddingSourceHash(text);
  });
  const indexNames = new Set(indexes.map((row) => row.indexname));
  const hasHnsw = indexNames.has("idx_psd_embedding_hnsw");

  console.log(JSON.stringify({
    extensions,
    documents: rows.length,
    modelId,
    missingEmbeddings: missing.length,
    wrongDimensions: wrongDimensions.length,
    staleEmbeddings: stale.length,
    hnswIndex: hasHnsw,
  }, null, 2));

  if (!hasHnsw || missing.length > 0 || wrongDimensions.length > 0 || stale.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("[check-search-v2-health] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void db.$disconnect();
  });
