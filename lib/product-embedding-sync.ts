import { db } from "@/lib/db";
import {
  buildProductEmbeddingText,
  embedTexts,
  isSemanticSearchEnabled,
  toPgVectorLiteral,
} from "@/lib/embeddings";

/**
 * Re-embeds a single product's search document after its text/fitment changed.
 * Reads the (already trigger-refreshed) product_search_documents row, embeds the
 * composed text, and writes the vector back.
 *
 * Best-effort and self-contained: a no-op when semantic search is disabled, and
 * never throws — callers fire it via `after()` so a failed/slow embed can never
 * block or break the product save. A miss just leaves the previous vector in
 * place until the next edit or a backfill run.
 */
export async function reembedProductSearchDocument(productId: string): Promise<void> {
  if (!isSemanticSearchEnabled()) return;

  try {
    const rows = await db.$queryRaw<
      Array<{
        product_name: string;
        category_name: string;
        brand_name: string;
        car_brand_text: string;
        car_model_text: string;
        fitment_text: string;
        keyword_text: string;
      }>
    >`
      SELECT product_name, category_name, brand_name,
             car_brand_text, car_model_text, fitment_text, keyword_text
      FROM product_search_documents
      WHERE product_id = ${productId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return;

    const text = buildProductEmbeddingText({
      productName: row.product_name,
      categoryName: row.category_name,
      brandName: row.brand_name,
      carText: `${row.car_brand_text} ${row.car_model_text}`.trim(),
      fitmentText: row.fitment_text,
      keywordText: row.keyword_text,
    });

    const [vector] = await embedTexts([text]);
    if (!vector) return;

    await db.$executeRaw`
      UPDATE product_search_documents
      SET embedding = ${toPgVectorLiteral(vector)}::vector, updated_at = now()
      WHERE product_id = ${productId}
    `;
  } catch (error) {
    console.warn(
      "[product-embedding-sync] re-embed skipped:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
