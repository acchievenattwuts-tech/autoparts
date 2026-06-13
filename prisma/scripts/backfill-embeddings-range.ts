/**
 * Backfills semantic embeddings for a bounded product-code range.
 *
 * Intended for guarded production imports where only the newly-created products
 * should be embedded immediately after import.
 *
 *   npx tsx --env-file=.env.local prisma/scripts/backfill-embeddings-range.ts --from-code=P0632 --to-code=P0756
 *   npx tsx --env-file=.env.local prisma/scripts/backfill-embeddings-range.ts --from-code=P0632 --to-code=P0756 --all
 */
import { db } from "@/lib/db";
import { buildProductEmbeddingText, embedTexts, toPgVectorLiteral } from "@/lib/embeddings";

const BATCH_SIZE = 25;

type PsdRow = {
  product_id: string;
  product_code: string;
  product_name: string;
  category_name: string;
  brand_name: string;
  car_brand_text: string;
  car_model_text: string;
  fitment_text: string;
  keyword_text: string;
};

function parseArgs(argv: string[]): { fromCode: string; toCode: string; reembedAll: boolean } {
  const fromCode = argv.find((arg) => arg.startsWith("--from-code="))?.slice("--from-code=".length);
  const toCode = argv.find((arg) => arg.startsWith("--to-code="))?.slice("--to-code=".length);
  const reembedAll = argv.includes("--all");

  if (!fromCode || !/^P\d{4,}$/.test(fromCode)) {
    throw new Error("Missing or invalid --from-code=P####");
  }
  if (!toCode || !/^P\d{4,}$/.test(toCode)) {
    throw new Error("Missing or invalid --to-code=P####");
  }
  if (fromCode > toCode) {
    throw new Error(`Invalid product-code range: ${fromCode} > ${toCode}`);
  }

  return { fromCode, toCode, reembedAll };
}

async function main(): Promise<void> {
  const { fromCode, toCode, reembedAll } = parseArgs(process.argv.slice(2));

  const rows = await db.$queryRaw<PsdRow[]>`
    SELECT product_id, product_code, product_name, category_name, brand_name,
           car_brand_text, car_model_text, fitment_text, keyword_text
    FROM product_search_documents
    WHERE product_code BETWEEN ${fromCode} AND ${toCode}
      AND (${reembedAll} OR embedding IS NULL)
    ORDER BY product_code
  `;

  console.log(
    `[backfill-embeddings-range] ${rows.length} row(s) to embed (${fromCode}..${toCode}, mode=${reembedAll ? "all" : "missing"})`,
  );
  if (rows.length === 0) return;

  let done = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const texts = batch.map((row) =>
      buildProductEmbeddingText({
        productName: row.product_name,
        categoryName: row.category_name,
        brandName: row.brand_name,
        carText: `${row.car_brand_text} ${row.car_model_text}`.trim(),
        fitmentText: row.fitment_text,
        keywordText: row.keyword_text,
      }),
    );

    try {
      const vectors = await embedTexts(texts);
      if (vectors.length !== batch.length) throw new Error("vector count mismatch");

      await db.$transaction(
        batch.map((row, idx) =>
          db.$executeRaw`
            UPDATE product_search_documents
            SET embedding = ${toPgVectorLiteral(vectors[idx])}::vector, updated_at = now()
            WHERE product_id = ${row.product_id}
          `,
        ),
      );
      done += batch.length;
      console.log(`[backfill-embeddings-range] embedded ${done}/${rows.length}`);
    } catch (error) {
      failed += batch.length;
      console.error(
        `[backfill-embeddings-range] batch ${i / BATCH_SIZE + 1} failed:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  console.log(`[backfill-embeddings-range] done. embedded=${done} failed=${failed}`);
  if (failed > 0) {
    throw new Error(`Failed to embed ${failed} row(s); rerun the same command to retry.`);
  }
}

main()
  .catch((error) => {
    console.error("[backfill-embeddings-range] fatal:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void db.$disconnect();
  });
