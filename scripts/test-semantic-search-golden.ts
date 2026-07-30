import { db } from "@/lib/db";
import { isSemanticSearchEnabled } from "@/lib/embeddings";
import { searchProductIdsV2, type ProductSearchResult } from "@/lib/product-search";

/**
 * Golden test for hybrid semantic search (PRODUCT_SEARCH_SEMANTIC=on).
 *
 * Each case is run TWICE against the real catalog with internal caches bypassed:
 *   A) semantic enabled  (production behaviour when the flag is on)
 *   B) disableSemantic:true (lexical-only baseline = flag-off behaviour)
 *
 * Comparing A vs B proves three separate things that a single run cannot:
 *   1. the vector path actually executes (retrievalMode "hybrid" + similarities)
 *   2. it improves recall/ranking on paraphrased queries a lexical index misses
 *   3. it is purely additive — strong lexical queries return an identical page,
 *      and non-product questions still return nothing (no semantic hallucination)
 */

const TAKE = 5;

type GoldenCase = {
  /** What the customer types. */
  query: string;
  /** Why this case exists (printed with the result). */
  intent: string;
  /** Top-1 product name must match. */
  expectTopName?: RegExp;
  /** At least one of the returned page's names must match. */
  expectAnyName?: RegExp;
  /** Total must be <= this (0 = must return nothing). */
  expectMaxTotal?: number;
  /** Semantic recall must have executed (>=1 vector candidate on the page). */
  expectSemanticFires?: boolean;
  /** Semantic must have admitted a product lexical search could not reach. */
  expectVectorRescue?: boolean;
  /** Lexical-only baseline must return nothing (semantic is the only path to a hit). */
  expectLexicalMiss?: boolean;
  /** Control: the returned page must be byte-identical with semantic off. */
  expectIdenticalToLexical?: boolean;
};

const GOLDEN_CASES: GoldenCase[] = [
  // --- Paraphrase / layman wording the lexical index does not contain ---------
  {
    query: "ตัวทำความเย็นแอร์วีออส",
    intent: "layman phrase for evaporator + Vios — lexical scores ZERO, semantic is the only path",
    expectTopName: /(คอยล์เย็น|ตู้แอร์|evaporator)/i,
    expectSemanticFires: true,
    expectVectorRescue: true,
    expectLexicalMiss: true,
  },
  {
    query: "ตัวกรองฝุ่นในห้องโดยสาร ซีวิค",
    intent: "descriptive phrase for cabin air filter + Civic — semantic must fix the part type",
    expectTopName: /(กรองแอร์|กรองอากาศ|filter)/i,
    expectSemanticFires: true,
    expectVectorRescue: true,
  },
  {
    query: "พัดลมเป่าลมเย็นในห้องโดยสาร วีโก้",
    intent: "descriptive phrase for blower motor + Vigo — semantic must fix the part type",
    expectTopName: /(โบลเวอร์|โบเวอร์|blower)/i,
    expectSemanticFires: true,
    expectVectorRescue: true,
  },
  {
    query: "ตัวดูดความชื้นน้ำยาแอร์",
    intent: "descriptive phrase for drier (ดรายเออร์/ไดเออร์)",
    expectAnyName: /(ดรายเออร์|ไดเออร์|drier|dryer)/i,
    expectSemanticFires: true,
  },
  {
    query: "ถังน้ำหล่อเย็นหน้ารถ ซิตี้",
    intent: "unambiguous radiator paraphrase + City — coolant wording rules out the condenser",
    expectTopName: /หม้อน้ำ/i,
    expectSemanticFires: true,
    expectVectorRescue: true,
  },
  {
    query: "รังผึ้งระบายความร้อน ซิตี้",
    intent:
      "AMBIGUOUS by catalog data — this shop's own aliases map รังผึ้งหม้อน้ำ→หม้อน้ำ, รังผึ้งแอร์→คอยล์ร้อน, รังผึ้งแอร์ใน→คอยล์เย็น (40 products), so any of the three cooling cores for the right car is a correct answer",
    expectTopName: /(หม้อน้ำ|แผงแอร์|คอยล์|radiator|condenser)/i,
    expectAnyName: /city/i,
    expectSemanticFires: true,
  },

  // --- Adaptive gate: enough lexical evidence must NOT pay for an embedding ---
  {
    query: "ปั๊มแอร์รถยนต์",
    intent: "layman phrase that still hits lexically — adaptive gate must stay lexical-only",
    expectTopName: /(คอมแอร์|compressor)/i,
    expectIdenticalToLexical: true,
  },

  // --- Controls: strong lexical evidence must be untouched by semantics ------
  {
    query: "P0104",
    intent: "exact product code — must short-circuit, semantics must not interfere",
    expectIdenticalToLexical: true,
  },
  {
    query: "หม้อน้ำ mazda 2",
    intent: "strong lexical query — semantics must not reorder/replace the page",
    expectTopName: /หม้อน้ำ/i,
    expectIdenticalToLexical: true,
  },
  {
    query: "คอยล์เย็น toyota",
    intent: "category + car brand, plenty of lexical hits — adaptive path must stay lexical",
    expectTopName: /(คอยล์เย็น|แผงแอร์)/i,
    expectIdenticalToLexical: true,
  },

  // --- Negative: semantics must not invent product matches ------------------
  {
    query: "ร้านอยู่ที่ไหน",
    intent: "not a product question — must return nothing even with vectors on",
    expectMaxTotal: 0,
  },
  {
    query: "เปิดกี่โมง โอนเงินยังไง",
    intent: "shop-policy chatter — must return nothing even with vectors on",
    expectMaxTotal: 0,
  },
];

type Row = { id: string; code: string; name: string };

const hydrate = async (result: ProductSearchResult): Promise<Row[]> => {
  if (result.ids.length === 0) return [];
  const products = await db.product.findMany({
    where: { id: { in: result.ids } },
    select: { id: true, code: true, name: true },
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  return result.ids
    .map((id) => byId.get(id))
    .filter((product): product is Row => Boolean(product));
};

const runSearch = (query: string, disableSemantic: boolean): Promise<ProductSearchResult> =>
  searchProductIdsV2(
    {
      query,
      isActive: true,
      skip: 0,
      take: TAKE,
      cacheProfile: "admin",
      disableSemantic,
    },
    { bypassInternalCaches: true },
  );

type CaseOutcome = {
  query: string;
  intent: string;
  passed: boolean;
  failures: string[];
  semanticMs: number;
  lexicalMs: number;
  semantic: {
    total: number;
    retrievalMode: ProductSearchResult["retrievalMode"];
    vectorCandidates: number;
    topSimilarity: number | null;
    vectorOnly: string[];
    names: string[];
  };
  lexical: { total: number; retrievalMode: ProductSearchResult["retrievalMode"]; names: string[] };
};

async function runCase(golden: GoldenCase): Promise<CaseOutcome> {
  const semanticStart = performance.now();
  const withSemantic = await runSearch(golden.query, false);
  const semanticMs = Math.round(performance.now() - semanticStart);

  const lexicalStart = performance.now();
  const lexicalOnly = await runSearch(golden.query, true);
  const lexicalMs = Math.round(performance.now() - lexicalStart);

  const [semanticRows, lexicalRows] = await Promise.all([
    hydrate(withSemantic),
    hydrate(lexicalOnly),
  ]);

  const similarities = Object.values(withSemantic.semanticSimilarities ?? {});
  const vectorOnlyIds = withSemantic.vectorOnlyProductIds ?? [];
  const vectorOnlyCodes = vectorOnlyIds
    .map((id) => semanticRows.find((row) => row.id === id)?.code ?? id)
    .sort();
  const lexicalIdSet = new Set(lexicalOnly.ids);
  const rescuedCodes = semanticRows
    .filter((row) => !lexicalIdSet.has(row.id))
    .map((row) => row.code);

  const failures: string[] = [];
  const top = semanticRows[0];
  if (golden.expectTopName && !(top && golden.expectTopName.test(top.name))) {
    failures.push(`top-1 name !~ ${golden.expectTopName} (got "${top?.name ?? "<none>"}")`);
  }
  if (golden.expectAnyName && !semanticRows.some((row) => golden.expectAnyName!.test(row.name))) {
    failures.push(`no returned name ~ ${golden.expectAnyName}`);
  }
  if (golden.expectMaxTotal !== undefined && withSemantic.total > golden.expectMaxTotal) {
    failures.push(`total ${withSemantic.total} > expected max ${golden.expectMaxTotal}`);
  }
  if (golden.expectSemanticFires && similarities.length === 0) {
    failures.push("semantic recall did not fire (no vector candidates on the page)");
  }
  if (golden.expectVectorRescue && rescuedCodes.length === 0) {
    failures.push("semantic admitted nothing beyond the lexical page");
  }
  if (golden.expectLexicalMiss && lexicalOnly.total !== 0) {
    failures.push(`lexical-only baseline was expected to miss, got total=${lexicalOnly.total}`);
  }
  if (
    golden.expectIdenticalToLexical &&
    withSemantic.ids.join(",") !== lexicalOnly.ids.join(",")
  ) {
    failures.push(
      `page differs from lexical-only baseline: [${semanticRows.map((r) => r.code).join(",")}] vs [${lexicalRows.map((r) => r.code).join(",")}]`,
    );
  }

  return {
    query: golden.query,
    intent: golden.intent,
    passed: failures.length === 0,
    failures,
    semanticMs,
    lexicalMs,
    semantic: {
      total: withSemantic.total,
      retrievalMode: withSemantic.retrievalMode,
      vectorCandidates: similarities.length,
      topSimilarity: similarities.length > 0 ? Math.max(...similarities) : null,
      vectorOnly: vectorOnlyCodes,
      names: semanticRows.map((row) => `${row.code} ${row.name}`),
    },
    lexical: {
      total: lexicalOnly.total,
      retrievalMode: lexicalOnly.retrievalMode,
      names: lexicalRows.map((row) => `${row.code} ${row.name}`),
    },
  };
}

async function main(): Promise<void> {
  const enabled = isSemanticSearchEnabled();
  console.log(
    `[semantic-golden] PRODUCT_SEARCH_SEMANTIC=${process.env.PRODUCT_SEARCH_SEMANTIC ?? "<unset>"} → isSemanticSearchEnabled=${enabled}`,
  );
  if (!enabled) {
    console.error(
      "[semantic-golden] semantic search is DISABLED (flag off or no Gemini keys) — aborting; the A/B comparison would be meaningless.",
    );
    process.exitCode = 1;
    return;
  }

  const outcomes: CaseOutcome[] = [];
  for (const golden of GOLDEN_CASES) {
    const outcome = await runCase(golden);
    outcomes.push(outcome);
    console.log(`\n${outcome.passed ? "PASS" : "FAIL"}  "${outcome.query}"  — ${outcome.intent}`);
    console.log(
      `  semantic: total=${outcome.semantic.total} mode=${outcome.semantic.retrievalMode} vectorCandidates=${outcome.semantic.vectorCandidates} topSim=${outcome.semantic.topSimilarity?.toFixed(3) ?? "-"} vectorOnly=[${outcome.semantic.vectorOnly.join(",")}] ${outcome.semanticMs}ms`,
    );
    for (const name of outcome.semantic.names) console.log(`    + ${name}`);
    console.log(
      `  lexical : total=${outcome.lexical.total} mode=${outcome.lexical.retrievalMode} ${outcome.lexicalMs}ms`,
    );
    for (const name of outcome.lexical.names) console.log(`    - ${name}`);
    for (const failure of outcome.failures) console.log(`  !! ${failure}`);
  }

  const failed = outcomes.filter((outcome) => !outcome.passed);
  const firedCount = outcomes.filter((outcome) => outcome.semantic.vectorCandidates > 0).length;
  const rescueCount = outcomes.filter((outcome) => outcome.semantic.vectorOnly.length > 0).length;
  console.log(
    `\n[semantic-golden] ${outcomes.length - failed.length}/${outcomes.length} passed | semantic fired on ${firedCount} case(s) | vector-only rescue on ${rescueCount} case(s)`,
  );
  if (failed.length > 0) {
    console.log(`[semantic-golden] failed: ${failed.map((outcome) => outcome.query).join(" | ")}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("[semantic-golden] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void db.$disconnect();
  });
