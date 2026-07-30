/**
 * Retrieval-quality evaluation for hybrid semantic search.
 *
 * Runs a ground-truth eval set (layman/paraphrase queries where the correct part
 * category and car are known) through the production vector recall, then re-ranks
 * the SAME candidate set under each scoring variant so a proposed weighting change
 * can be judged on measured deltas instead of intuition.
 *
 * Per query it also validates the mirrored score against the live
 * `searchProductIdsV2` page — when `mirrorValid=false` the case is outside the
 * vector-only path (the mirror does not model that) and its variant rows are
 * informational only.
 *
 * Read-only. Costs one Gemini query-embedding per case.
 *
 *   npm run evaluate:semantic-retrieval
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
  SEARCH_V2_VECTOR_WEIGHT,
  type ScoredCandidate,
} from "./semantic-eval-core";

type EvalCase = {
  query: string;
  /** POSIX-regex-compatible pattern for the category that SHOULD win. */
  expectCategory: RegExp;
  /** Car token the winning row should mention, or null for universal parts. */
  carToken: RegExp | null;
};

const EVAL_SET: EvalCase[] = [
  { query: "รังผึ้งระบายความร้อน ซิตี้", expectCategory: /^หม้อน้ำ \(Radiator\)/, carToken: /city/i },
  { query: "ตัวทำความเย็นแอร์วีออส", expectCategory: /^คอยล์เย็น/, carToken: /vios/i },
  { query: "ตัวกรองฝุ่นในห้องโดยสาร ซีวิค", expectCategory: /^กรองแอร์/, carToken: /civic/i },
  { query: "พัดลมเป่าลมเย็นในห้องโดยสาร วีโก้", expectCategory: /^โบเวอร์/, carToken: /vigo/i },
  { query: "ตัวปรับแรงดันน้ำยาแอร์ วีโก้", expectCategory: /^วาล์ว \(Expansion/, carToken: /vigo/i },
  { query: "มอเตอร์หมุนพัดลมหน้าหม้อน้ำ ซีวิค", expectCategory: /^มอเตอร์พัดลม/, carToken: /civic/i },
  { query: "ตัวดูดความชื้นน้ำยาแอร์", expectCategory: /^ดรายเออร์/, carToken: null },
  { query: "ชุดหน้าคลัชคอมเพรสเซอร์ วีโก้", expectCategory: /^หน้าครัช/, carToken: /vigo/i },
  { query: "แผงระบายความร้อนน้ำยาแอร์ ดีแมค", expectCategory: /^คอยล์ร้อน/, carToken: /d-?max/i },
  { query: "ท่อยางน้ำหล่อเย็นเส้นบน ซิตี้", expectCategory: /^ท่อยางหม้อน้ำ/, carToken: /city/i },
  { query: "ถังน้ำหล่อเย็นหน้ารถ ซิตี้", expectCategory: /^หม้อน้ำ \(Radiator\)/, carToken: /city/i },
];

const TOP_N = 5;

type Variant = {
  name: string;
  /** Total score for a candidate under this variant. */
  score: (candidate: ScoredCandidate) => number;
  /** Optional hard filter applied before ranking (models a scope change). */
  keep?: (candidate: ScoredCandidate, carToken: RegExp | null) => boolean;
};

const baselineScore = (c: ScoredCandidate): number =>
  c.lexical_score + c.trigram + c.stock_bonus + c.sales_bonus + c.sim * SEARCH_V2_VECTOR_WEIGHT;

const matchesCar = (candidate: ScoredCandidate, carToken: RegExp | null): boolean =>
  carToken === null ||
  carToken.test(candidate.car_model_text) ||
  carToken.test(candidate.product_name);

const VARIANTS: Variant[] = [
  { name: "baseline (prod)", score: baselineScore },
  {
    name: "damp tiebreak x0.1",
    score: (c) =>
      c.lexical_score +
      0.1 * (c.trigram + c.stock_bonus + c.sales_bonus) +
      c.sim * SEARCH_V2_VECTOR_WEIGHT,
  },
  {
    name: "vector weight 1500",
    score: (c) => c.lexical_score + c.trigram + c.stock_bonus + c.sales_bonus + c.sim * 1500,
  },
  { name: "vector only", score: (c) => c.lexical_score + c.sim * SEARCH_V2_VECTOR_WEIGHT },
  { name: "car-scope (hard)", score: baselineScore, keep: matchesCar },
];

type VariantTally = { categoryTopN: number; categoryTop1: number; categoryAndCarTopN: number };

const rankOfExpected = (
  rows: ScoredCandidate[],
  evalCase: EvalCase,
  requireCar: boolean,
): number | null => {
  for (let index = 0; index < rows.length; index += 1) {
    const candidate = rows[index];
    if (!evalCase.expectCategory.test(candidate.category_name)) continue;
    if (requireCar && !matchesCar(candidate, evalCase.carToken)) continue;
    return index + 1;
  }
  return null;
};

const countGroundTruth = async (evalCase: EvalCase): Promise<number> => {
  const carFilter = evalCase.carToken
    ? Prisma.sql`AND (car_model_text ~* ${evalCase.carToken.source} OR product_name ~* ${evalCase.carToken.source})`
    : Prisma.empty;
  const rows = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    SELECT count(*) AS n
    FROM product_search_documents
    WHERE is_active AND category_name ~ ${evalCase.expectCategory.source}
      ${carFilter}
  `);
  return Number(rows[0]?.n ?? 0);
};

async function main(): Promise<void> {
  const tallies = new Map<string, VariantTally>(
    VARIANTS.map((variant) => [
      variant.name,
      { categoryTopN: 0, categoryTop1: 0, categoryAndCarTopN: 0 },
    ]),
  );
  let mirrorValidCount = 0;

  for (const evalCase of EVAL_SET) {
    const normalized = normalizeSearchText(evalCase.query);
    const forms = buildQueryForms(normalized);
    const groundTruth = await countGroundTruth(evalCase);
    const queryVector = await embedQuery(normalized, { bypassCache: true });
    if (!queryVector) {
      console.log(`\n### "${evalCase.query}" → query embedding unavailable (skipped)`);
      continue;
    }
    const candidates = await fetchScoredVectorCandidates(
      forms,
      toPgVectorLiteral(queryVector),
    );
    if (candidates.length === 0) {
      console.log(`\n### "${evalCase.query}" → no vector candidates above the floor (skipped)`);
      continue;
    }

    const live = await searchProductIdsV2(
      { query: evalCase.query, isActive: true, skip: 0, take: TOP_N, cacheProfile: "admin" },
      { bypassInternalCaches: true },
    );
    const mirroredTop = [...candidates]
      .sort((left, right) => baselineScore(right) - baselineScore(left))
      .slice(0, TOP_N)
      .map((candidate) => candidate.product_id);
    const mirrorValid =
      live.retrievalMode === "hybrid" && mirroredTop.join(",") === live.ids.join(",");
    if (mirrorValid) mirrorValidCount += 1;

    const sims = candidates.map((c) => c.sim);
    const trigrams = candidates.map((c) => c.trigram);
    console.log(
      `\n### "${evalCase.query}"  groundTruth=${groundTruth}  candidates=${candidates.length}` +
        `  liveMode=${live.retrievalMode}  liveTotal=${live.total}  mirrorValid=${mirrorValid}`,
    );
    console.log(
      `    sim ${Math.min(...sims).toFixed(3)}-${Math.max(...sims).toFixed(3)}` +
        ` | trigram ${Math.min(...trigrams).toFixed(0)}-${Math.max(...trigrams).toFixed(0)}` +
        ` | sales>0 ${candidates.filter((c) => c.sales_count > 0).length}/${candidates.length}` +
        ` | stock=0 ${candidates.filter((c) => c.stock <= 0).length}/${candidates.length}`,
    );

    for (const variant of VARIANTS) {
      const kept = variant.keep
        ? candidates.filter((candidate) => variant.keep?.(candidate, evalCase.carToken) ?? true)
        : candidates;
      const ranked = [...kept].sort((left, right) => variant.score(right) - variant.score(left));
      const categoryRank = rankOfExpected(ranked, evalCase, false);
      const categoryAndCarRank = rankOfExpected(ranked, evalCase, true);
      const tally = tallies.get(variant.name);
      if (tally) {
        if (categoryRank !== null && categoryRank <= TOP_N) tally.categoryTopN += 1;
        if (categoryRank === 1) tally.categoryTop1 += 1;
        if (categoryAndCarRank !== null && categoryAndCarRank <= TOP_N) {
          tally.categoryAndCarTopN += 1;
        }
      }
      const top = ranked[0];
      console.log(
        `    ${variant.name.padEnd(19)} n=${String(kept.length).padStart(2)}` +
          `  catRank=${String(categoryRank ?? "-").padStart(2)}` +
          `  cat+carRank=${String(categoryAndCarRank ?? "-").padStart(2)}` +
          `  top1=[${top ? shortCategory(top.category_name) : "-"}] ${top?.product_code ?? ""} ${top?.product_name.slice(0, 34) ?? ""}`,
      );
    }
  }

  console.log(`\n===== SUMMARY over ${EVAL_SET.length} cases (mirror valid on ${mirrorValidCount}) =====`);
  for (const [name, tally] of tallies) {
    console.log(
      `  ${name.padEnd(19)} correct category in top${TOP_N}: ${tally.categoryTopN}/${EVAL_SET.length}` +
        ` | at rank 1: ${tally.categoryTop1}/${EVAL_SET.length}` +
        ` | correct category+car in top${TOP_N}: ${tally.categoryAndCarTopN}/${EVAL_SET.length}`,
    );
  }
  console.log(
    "\nNote: a variant that does not beat the baseline on these counters is not worth shipping —" +
      " see PLAN.md item (17) for the recorded verdicts.",
  );
}

runHarness(main, "evaluate-semantic-retrieval");
