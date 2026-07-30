/**
 * Experiment: does changing the embedded product text improve part-type precision?
 *
 * The vector space separates CAR models well but part TYPES weakly (a condenser
 * and a radiator for the same car sit ~0.02 apart). This script tests candidate
 * compositions of the embedded text — category first, category repeated, a
 * labelled part-type prefix — by re-embedding a small subset IN MEMORY via real
 * Gemini calls and re-measuring cosine against the same query.
 *
 * Nothing is written to the database: no column is touched, no backfill is run.
 * Run this BEFORE ever considering `npm run backfill:embeddings --all`, because a
 * full re-embed rewrites every `embedding_source_hash` and cannot be undone
 * cheaply.
 *
 *   npm run experiment:semantic-embedding-text
 */
import { db } from "@/lib/db";
import { buildProductEmbeddingText, embedQuery, embedTexts } from "@/lib/embeddings";
import { normalizeSearchText } from "@/lib/search-normalization";
import { cosine, runHarness, shortCategory } from "./semantic-eval-core";

type SearchDoc = {
  product_code: string;
  product_name: string;
  category_name: string;
  brand_name: string;
  car_brand_text: string;
  car_model_text: string;
  fitment_text: string;
  keyword_text: string;
};

type TextVariant = {
  name: string;
  build: (doc: SearchDoc) => string;
};

const carText = (doc: SearchDoc): string =>
  `${doc.car_brand_text} ${doc.car_model_text}`.trim();

const join = (parts: Array<string | null | undefined>): string =>
  parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" • ");

const VARIANTS: TextVariant[] = [
  {
    // Exactly what production embeds today (lib/embeddings.ts).
    name: "current",
    build: (doc) =>
      buildProductEmbeddingText({
        productName: doc.product_name,
        categoryName: doc.category_name,
        brandName: doc.brand_name,
        carText: carText(doc),
        fitmentText: doc.fitment_text,
        keywordText: doc.keyword_text,
      }),
  },
  {
    name: "category first",
    build: (doc) =>
      join([
        doc.category_name,
        doc.product_name,
        doc.brand_name,
        carText(doc),
        doc.fitment_text,
        doc.keyword_text,
      ]),
  },
  {
    name: "category x2",
    build: (doc) =>
      join([
        doc.category_name,
        doc.category_name,
        doc.product_name,
        doc.brand_name,
        carText(doc),
        doc.fitment_text,
        doc.keyword_text,
      ]),
  },
  {
    name: "labelled type",
    build: (doc) =>
      join([
        `ชนิดอะไหล่: ${doc.category_name}`,
        doc.product_name,
        doc.brand_name,
        carText(doc),
        doc.fitment_text,
        doc.keyword_text,
      ]),
  },
];

type ExperimentCase = {
  query: string;
  /** Category the query really asks for. */
  correct: RegExp;
  /** Category that currently outranks it. */
  confuser: RegExp;
  /** Subset to re-embed — keep small, every row is a live Gemini call. */
  productCodes: string[];
};

const CASES: ExperimentCase[] = [
  {
    query: "รังผึ้งระบายความร้อน ซิตี้",
    correct: /^หม้อน้ำ \(Radiator\)/,
    confuser: /^คอยล์ร้อน/,
    productCodes: [
      "P0072", "P0074", "P0071", "P0879", "P0070",
      "P0386", "P0502", "P0522", "P0054", "P0166",
    ],
  },
  {
    query: "ตัวทำความเย็นแอร์วีออส",
    correct: /^คอยล์เย็น/,
    confuser: /^คอยล์ร้อน/,
    productCodes: [
      "P0826", "P0833", "P0319", "P0823", "P0827",
      "P0877", "P0772", "P0065", "P0771", "P0044",
    ],
  },
];

async function main(): Promise<void> {
  for (const experiment of CASES) {
    const docs = await db.$queryRaw<SearchDoc[]>`
      SELECT product_code, product_name, category_name, brand_name,
             car_brand_text, car_model_text, fitment_text, keyword_text
      FROM product_search_documents
      WHERE product_code = ANY(${experiment.productCodes})
    `;
    if (docs.length === 0) {
      console.log(`\n=== "${experiment.query}" → subset not found in this database (skipped)`);
      continue;
    }
    const queryVector = await embedQuery(normalizeSearchText(experiment.query), {
      bypassCache: true,
    });
    if (!queryVector) {
      console.log(`\n=== "${experiment.query}" → query embedding unavailable (skipped)`);
      continue;
    }

    console.log(
      `\n=== "${experiment.query}"  (${docs.length} products re-embedded per variant)` +
        `\n    a NEGATIVE margin means the wrong part type still wins`,
    );
    for (const variant of VARIANTS) {
      const startedAt = Date.now();
      const vectors = await embedTexts(docs.map((doc) => variant.build(doc)));
      const elapsedMs = Date.now() - startedAt;
      const ranked = docs
        .map((doc, index) => ({ doc, sim: cosine(queryVector, vectors[index] ?? []) }))
        .sort((left, right) => right.sim - left.sim);
      const bestCorrect = ranked.find((row) => experiment.correct.test(row.doc.category_name));
      const bestConfuser = ranked.find((row) => experiment.confuser.test(row.doc.category_name));
      const correctRank = bestCorrect ? ranked.indexOf(bestCorrect) + 1 : null;
      const margin =
        bestCorrect && bestConfuser ? bestCorrect.sim - bestConfuser.sim : null;
      console.log(
        `  ${variant.name.padEnd(15)} correctRank=${String(correctRank ?? "-").padStart(2)}/${ranked.length}` +
          ` correct=${bestCorrect?.sim.toFixed(3) ?? "-"} (${bestCorrect?.doc.product_code ?? "-"})` +
          ` confuser=${bestConfuser?.sim.toFixed(3) ?? "-"} (${bestConfuser?.doc.product_code ?? "-"})` +
          ` margin=${margin === null ? "-" : `${margin >= 0 ? "+" : ""}${margin.toFixed(3)}`}` +
          ` embed=${elapsedMs}ms`,
      );
      console.log(
        `      ${ranked
          .slice(0, 6)
          .map((row) => `${row.doc.product_code}[${shortCategory(row.doc.category_name)}]${row.sim.toFixed(3)}`)
          .join("  ")}`,
      );
    }
  }
}

runHarness(main, "experiment-semantic-embedding-text");
