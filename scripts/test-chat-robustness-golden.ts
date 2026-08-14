/**
 * Golden suite: chat robustness invariants against the REAL production catalog.
 *
 * Pins the three additions made for "เข้าใจลูกค้าให้มากที่สุด โดยไม่ตอบผิด":
 *
 *   A. Intent typo backstop (lib/chat-core/intent-typo-guard.ts) — reclassifies a
 *      MIS-KEYED high-stakes keyword ("เครม" → เคลม) that the literal router rules
 *      cannot see. Its only real risk is a FALSE POSITIVE: a genuine parts question
 *      swallowed as a claim/payment hand-off. This suite proves against the live
 *      catalog that no product name, category, car model/brand, brand alias, or
 *      search keyword falls inside the 1-edit radius of any guarded keyword.
 *
 *   B. Thai spelling fold (lib/thai-spelling-fold.ts) — must never MERGE two
 *      genuinely different catalog terms, which would turn a recall win into a
 *      wrong answer. Proven by folding every active category and car model and
 *      asserting the folded forms stay pairwise distinct.
 *
 *   C. Fold recovery (product-search-bridge) — must actually recover the decomposed
 *      `ํา` spelling of ำ against the live search engine, and must stay dormant for
 *      ordinary queries (the "worst case = unchanged" guarantee).
 *
 * Expectations are computed FROM the live catalog, never hardcoded, so the suite
 * stays green as products come and go — what it pins are the invariants.
 *
 * Read-only. Requires DATABASE_URL.
 *
 *   npm run test:chat-robustness-golden
 */
import { db } from "@/lib/db";
import { searchProductIdsV2 } from "@/lib/product-search";
import { CHAT_INTENT_TYPO_KEYWORDS, detectChatIntentTypo } from "@/lib/chat-core/intent-typo-guard";
import { containsWithinEditDistance } from "@/lib/chat-core/typo-distance";
import { foldThaiSpelling, needsThaiTypingRepair, repairThaiTyping } from "@/lib/thai-spelling-fold";
import { normalizeSearchText } from "@/lib/search-normalization";
import {
  matchCategoryAliasRows,
  type CategoryAliasResolverRow,
} from "@/lib/category-alias-resolver";

/** Must mirror TYPO_MAX_EDITS in intent-typo-guard.ts. */
const TYPO_MAX_EDITS = 1;
/** Cap the per-check reporting so a broad failure stays readable. */
const MAX_REPORTED_COLLISIONS = 10;

let pass = 0;
let fail = 0;
const failures: string[] = [];

function report(ok: boolean, label: string): void {
  if (ok) {
    pass += 1;
    console.log(`  ✔ ${label}`);
  } else {
    fail += 1;
    failures.push(label);
    console.log(`  ✖ ${label}`);
  }
}

const foldCompact = (value: string): string => foldThaiSpelling(value).replace(/\s+/g, "");

type CatalogTerm = { source: string; text: string };

async function loadCatalogTerms(): Promise<CatalogTerm[]> {
  const [products, categories, models, brands, brandAliases, keywords, categoryAliases] =
    await Promise.all([
      db.product.findMany({
        where: { isActive: true, isStorefrontVisible: true },
        select: { name: true },
      }),
      db.category.findMany({ where: { isActive: true }, select: { name: true } }),
      db.carModel.findMany({ where: { isActive: true }, select: { name: true } }),
      db.carBrand.findMany({ where: { isActive: true }, select: { name: true } }),
      db.carBrandAlias.findMany({ where: { isActive: true }, select: { alias: true } }),
      db.searchKeyword.findMany({ select: { term: true } }),
      db.categoryAlias.findMany({ where: { isActive: true }, select: { alias: true } }),
    ]);

  return [
    ...products.map((row) => ({ source: "Product.name", text: row.name })),
    ...categories.map((row) => ({ source: "Category.name", text: row.name })),
    ...models.map((row) => ({ source: "CarModel.name", text: row.name })),
    ...brands.map((row) => ({ source: "CarBrand.name", text: row.name })),
    ...brandAliases.map((row) => ({ source: "CarBrandAlias.alias", text: row.alias })),
    ...keywords.map((row) => ({ source: "SearchKeyword.term", text: row.term })),
    ...categoryAliases.map((row) => ({ source: "CategoryAlias.alias", text: row.alias })),
  ].filter((term) => Boolean(term.text?.trim()));
}

/** A. The typo backstop must not claim any word the catalog actually sells. */
async function checkTypoGuardNonCollision(terms: CatalogTerm[]): Promise<void> {
  console.log(
    `\n[A] typo backstop — ${CHAT_INTENT_TYPO_KEYWORDS.length} คำ × ${terms.length} คำในแคตตาล็อก (รัศมี ${TYPO_MAX_EDITS} edit)`,
  );

  for (const keyword of CHAT_INTENT_TYPO_KEYWORDS) {
    const needle = keyword.folded.replace(/\s+/g, "");
    const collisions: string[] = [];
    for (const term of terms) {
      if (containsWithinEditDistance(needle, foldCompact(term.text), TYPO_MAX_EDITS)) {
        collisions.push(`${term.source} "${term.text}"`);
        if (collisions.length >= MAX_REPORTED_COLLISIONS) break;
      }
    }
    report(
      collisions.length === 0,
      collisions.length === 0
        ? `"${keyword.keyword}" (${keyword.reason}) ไม่ชนกับคำในแคตตาล็อก`
        : `"${keyword.keyword}" (${keyword.reason}) ชนกับ ${collisions.length}+ รายการ: ${collisions
            .slice(0, 3)
            .join(", ")}`,
    );
  }
}

/** A'. Real product questions from the catalog must never be claimed by the backstop. */
async function checkTypoGuardOnRealQuestions(terms: CatalogTerm[]): Promise<void> {
  console.log("\n[A'] typo backstop — คำถามสินค้าจริงต้องไม่ถูกจับ");

  const productNames = terms.filter((term) => term.source === "Product.name").slice(0, 400);
  const claimed = productNames
    .map((term) => ({ text: term.text, match: detectChatIntentTypo(term.text) }))
    .filter((row) => row.match !== null);

  report(
    claimed.length === 0,
    claimed.length === 0
      ? `ชื่อสินค้า ${productNames.length} รายการ ไม่มีรายการใดถูกจับเป็นเจตนาแอดมิน`
      : `ชื่อสินค้าถูกจับผิด ${claimed.length} รายการ เช่น "${claimed[0]?.text}" → ${claimed[0]?.match?.keyword}`,
  );

  // The shape customers actually type: part + car, built from live master data.
  const [category] = terms.filter((term) => term.source === "Category.name");
  const models = terms.filter((term) => term.source === "CarModel.name").slice(0, 40);
  const composed = models.map((model) => `${category?.text ?? "หม้อน้ำ"} ${model.text} ราคาเท่าไหร่`);
  const composedClaimed = composed.filter((text) => detectChatIntentTypo(text) !== null);
  report(
    composedClaimed.length === 0,
    composedClaimed.length === 0
      ? `คำถาม "หมวด + รุ่นรถ + ราคา" ${composed.length} แบบ ไม่ถูกจับผิด`
      : `คำถามสินค้าถูกจับผิด: ${composedClaimed.slice(0, 3).join(" | ")}`,
  );
}

/**
 * B. The fold must never merge two catalog terms that the EXISTING normalization
 * keeps apart.
 *
 * Measured against `normalizeSearchText`, not against the raw strings, because the
 * whole system already treats case/whitespace variants as one term. Comparing to
 * raw strings would flag pre-existing master-data duplicates (e.g. "MIRAGE" and
 * "Mirage" as two CarModel rows) as if the fold had caused them — the fold's job is
 * only to add no NEW merges on top of today's baseline.
 */
async function checkFoldKeepsCatalogTermsDistinct(terms: CatalogTerm[]): Promise<void> {
  console.log("\n[B] Thai fold — ต้องไม่รวมคำที่ต่างกันเกินกว่าที่ระบบรวมอยู่แล้ว");

  for (const source of ["Category.name", "CarModel.name", "CarBrand.name"]) {
    const values = Array.from(
      new Set(terms.filter((term) => term.source === source).map((term) => term.text)),
    );
    // Today's baseline: how many distinct terms the live system already sees.
    const baseline = new Set(values.map((value) => normalizeSearchText(value)));
    const folded = new Set(values.map((value) => foldCompact(value)));

    const newlyMerged = new Map<string, string[]>();
    for (const value of values) {
      const key = foldCompact(value);
      const list = newlyMerged.get(key) ?? [];
      list.push(value);
      newlyMerged.set(key, list);
    }
    const extraMerges = Array.from(newlyMerged.values()).filter(
      (list) => new Set(list.map((value) => normalizeSearchText(value))).size > 1,
    );

    report(
      extraMerges.length === 0,
      extraMerges.length === 0
        ? `${source}: ${values.length} ชื่อ (ระบบเห็นเป็น ${baseline.size} คำ) fold ไม่รวมเพิ่ม — เหลือ ${folded.size} คำ`
        : `${source}: fold รวมคำที่ระบบยังแยกอยู่ — ${extraMerges
            .slice(0, 3)
            .map((list) => list.join(" = "))
            .join(" | ")}`,
    );
  }
}

/** C. Typing repair must work against the live engine, and stay dormant otherwise. */
async function checkFoldRecoveryAgainstEngine(terms: CatalogTerm[]): Promise<void> {
  console.log("\n[C] typing repair — ต้องกู้คำที่พิมพ์ ำ แบบแยกอักขระได้จริง");

  // Pick a real, currently-sellable term containing ำ so the case is grounded in
  // what the shop actually stocks rather than an invented word.
  const withSaraAm = terms.find(
    (term) =>
      (term.source === "Category.name" || term.source === "SearchKeyword.term") &&
      term.text.includes("ำ") &&
      term.text.trim().length <= 40,
  );

  if (!withSaraAm) {
    report(false, "หาคำในแคตตาล็อกที่มี ำ ไม่เจอ — ตรวจข้อนี้ไม่ได้");
    return;
  }

  // Strip the "(English)" suffix categories carry, so the query reads like a
  // customer's, then decompose ำ into nikhahit + sara aa (the invisible slip).
  const plain = withSaraAm.text.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const decomposed = plain.replace(/ำ/g, "ํา");

  const repaired = repairThaiTyping(decomposed);
  const [correct, mistyped, recovered] = await Promise.all([
    searchProductIdsV2(
      { query: plain, isActive: true, isStorefrontVisible: true, skip: 0, take: 5 },
      { bypassInternalCaches: true },
    ),
    searchProductIdsV2(
      { query: decomposed, isActive: true, isStorefrontVisible: true, skip: 0, take: 5 },
      { bypassInternalCaches: true },
    ),
    searchProductIdsV2(
      { query: repaired, isActive: true, isStorefrontVisible: true, skip: 0, take: 5 },
      { bypassInternalCaches: true },
    ),
  ]);

  console.log(
    `  ("${plain}" = ${correct.total} · พิมพ์แยกอักขระ = ${mistyped.total} · หลังซ่อม = ${recovered.total})`,
  );

  report(needsThaiTypingRepair(decomposed), `"${decomposed}" ต้องเข้าเงื่อนไขการซ่อม`);
  report(correct.total > 0, `คำที่สะกดถูก "${plain}" ต้องเจอสินค้า (ฐานเปรียบเทียบ)`);
  // The repair must reconstruct the correct spelling exactly — that is what makes it
  // safe to send to an index that stores raw catalog text.
  report(
    repaired === plain,
    `ซ่อมแล้วต้องได้คำที่สะกดถูกเป๊ะ ("${repaired}" ${repaired === plain ? "=" : "≠"} "${plain}")`,
  );
  report(
    recovered.total >= mistyped.total,
    `การซ่อมต้องไม่ทำให้ผลแย่ลง (${mistyped.total} → ${recovered.total})`,
  );
  report(
    recovered.total === correct.total,
    `ผลหลังซ่อมต้องเท่ากับคำที่สะกดถูก (${recovered.total} = ${correct.total})`,
  );
}

/** C'. Ordinary queries must not trigger the extra search at all. */
async function checkFoldStaysDormant(terms: CatalogTerm[]): Promise<void> {
  console.log("\n[C'] typing repair — คำค้นปกติต้องไม่ยิง query เพิ่ม");

  const categories = terms.filter((term) => term.source === "Category.name");
  const models = terms.filter((term) => term.source === "CarModel.name").slice(0, 30);
  const normalQueries = [
    ...categories.map((term) => term.text.replace(/\s*\([^)]*\)\s*$/, "").trim()),
    ...models.map((term) => term.text),
  ].filter(Boolean);

  const triggered = normalQueries.filter((query) => needsThaiTypingRepair(query));
  report(
    triggered.length === 0,
    triggered.length === 0
      ? `คำค้นที่สะกดถูก ${normalQueries.length} คำ ไม่มีคำใดยิง retry เพิ่ม`
      : `คำค้นปกติยิง retry โดยไม่จำเป็น: ${triggered.slice(0, 5).join(", ")}`,
  );
}

/**
 * D. The vehicle self-healing loop, against real master data.
 *
 * The loop's one catastrophic failure mode is aliasing a REAL vehicle to a
 * DIFFERENT one, so this proves the guardrails hold for every active vehicle in
 * the catalog — not for a handful of hand-picked examples.
 */
async function checkVehicleSynonymLoop(terms: CatalogTerm[]): Promise<void> {
  console.log("\n[D] วงจรซ่อมชื่อรถ — ต้องไม่ทำให้รุ่นจริงกลายเป็นคำพ้องของรุ่นอื่น");

  const { vehicleSpellingIsAlreadyKnown, vehicleSpellingCollidesWithPart } = await import(
    "@/lib/chat-core/vehicle-synonym-guardrails"
  );
  const { resolveVehicleSpellingTarget } = await import("@/lib/chat-core/vehicle-synonym-staging");

  const models = terms.filter((term) => term.source === "CarModel.name").map((term) => term.text);
  const brands = terms.filter((term) => term.source === "CarBrand.name").map((term) => term.text);
  const synonyms = await db.searchSynonym.findMany({
    where: { isActive: true },
    select: { term: true, synonyms: true },
  });
  const knownSpellings = [
    ...models,
    ...brands,
    ...synonyms.flatMap((row) => [row.term, ...(row.synonyms ?? [])]),
  ];

  // Every real vehicle name must be recognised as "already known", so it can never
  // be staged as a typo of something else.
  const unprotected = [...models, ...brands].filter(
    (name) => !vehicleSpellingIsAlreadyKnown(name, knownSpellings),
  );
  report(
    unprotected.length === 0,
    unprotected.length === 0
      ? `ชื่อรุ่น/ยี่ห้อจริงทั้ง ${models.length + brands.length} ชื่อ ถูกกันไว้ไม่ให้กลายเป็นคำผิด`
      : `ชื่อจริงที่ไม่ถูกกัน: ${unprotected.slice(0, 5).join(", ")}`,
  );

  // Every accepted spelling already in SearchSynonym must likewise be protected.
  const allSpellings = Array.from(
    new Set(synonyms.flatMap((row) => [row.term, ...(row.synonyms ?? [])])),
  );
  const unprotectedSpellings = allSpellings.filter(
    (spelling) => !vehicleSpellingIsAlreadyKnown(spelling, knownSpellings),
  );
  report(
    unprotectedSpellings.length === 0,
    unprotectedSpellings.length === 0
      ? `การสะกดที่ระบบรู้จักแล้ว ${allSpellings.length} แบบ ถูกกันครบ`
      : `การสะกดที่ไม่ถูกกัน: ${unprotectedSpellings.slice(0, 5).join(", ")}`,
  );

  // No active category / category alias may pass as a vehicle spelling.
  const partTerms = terms
    .filter((term) => term.source === "Category.name" || term.source === "CategoryAlias.alias")
    .map((term) => term.text);
  const partsThatLeak = partTerms.filter(
    (part) => !vehicleSpellingCollidesWithPart(part, partTerms),
  );
  report(
    partsThatLeak.length === 0,
    partsThatLeak.length === 0
      ? `คำอะไหล่ ${partTerms.length} คำ ไม่มีคำใดหลุดไปเป็นชื่อรุ่นรถได้`
      : `คำอะไหล่ที่หลุด: ${partsThatLeak.slice(0, 5).join(", ")}`,
  );

  // The resolver must accept a real model name and REJECT an invented one.
  const sampleModel = models.find((name) => name.length >= 4);
  if (sampleModel) {
    const resolved = await resolveVehicleSpellingTarget(sampleModel);
    report(
      resolved !== null,
      `resolve "${sampleModel}" ได้เป็น "${resolved?.canonicalTerm ?? "-"}" (${resolved?.kind ?? "-"})`,
    );
  }
  const invented = await resolveVehicleSpellingTarget("รถรุ่นที่ไม่มีอยู่จริงเลย");
  report(invented === null, "รุ่นที่ไม่มีในระบบต้อง resolve ไม่ได้ (ห้ามเดา)");

  // An ambiguous name shared by two active rows must resolve to nothing rather than
  // pick one. Production currently has exactly this (MIRAGE / Mirage).
  const byNormalized = new Map<string, string[]>();
  for (const name of models) {
    const key = normalizeSearchText(name);
    byNormalized.set(key, [...(byNormalized.get(key) ?? []), name]);
  }
  const ambiguous = Array.from(byNormalized.values()).find((list) => list.length > 1);
  if (ambiguous) {
    const resolved = await resolveVehicleSpellingTarget(ambiguous[0]);
    report(
      resolved === null,
      `ชื่อกำกวม "${ambiguous.join(" / ")}" ต้อง resolve ไม่ได้ (ได้ ${resolved?.canonicalTerm ?? "null"})`,
    );
  } else {
    console.log("  (ไม่มีชื่อรุ่นกำกวมในระบบตอนนี้ — ข้ามการตรวจข้อนี้)");
  }
}

async function checkCuratedEnglishCategoryAliases(): Promise<void> {
  console.log("\n[E] English category aliases — typo fixes and unchanged controls");
  const rows: CategoryAliasResolverRow[] = await db.categoryAlias.findMany({
    where: {
      isActive: true,
      OR: [{ kind: "SKIP_CATEGORY" }, { kind: "MATCH", category: { isActive: true } }],
    },
    select: {
      alias: true,
      kind: true,
      matchMode: true,
      priority: true,
      isActive: true,
      category: { select: { id: true, name: true, isActive: true } },
    },
  });
  const cases = [
    ["cabin air filter Honda City", "กรองแอร์ (Cabin air filter)"],
    ["blower moter Hoda Jass 2009", "โบเวอร์ พัดลมแอร์ (Blower Motor)"],
    ["condensor fan moter Toyta Vioz", "มอเตอร์พัดลมหน้าเครื่อง / หน้าแผงแอร์ (Condenser Fan Motor)"],
    ["air filter Honda City", "กรองอากาศ (Air Filter)"],
    ["blower motor Honda Jazz", "โบเวอร์ พัดลมแอร์ (Blower Motor)"],
    ["condensor Camry", "คอยล์ร้อน (Condenser)"],
  ] as const;

  for (const [query, expected] of cases) {
    const match = matchCategoryAliasRows([query], rows);
    const actual = match?.kind === "MATCH" ? match.categoryName : null;
    report(actual === expected, `"${query}" → ${actual ?? "none"} (expected ${expected})`);
  }
}

async function checkBt50ProFitmentRemediation(): Promise<void> {
  console.log("\n[F] Mazda BT-50 Pro — dedicated master fitment must return the known condenser");
  const expected = await db.product.findUnique({ where: { code: "P0080" }, select: { id: true } });
  const result = await searchProductIdsV2(
    {
      query: "condensor Mazda BT-50 Pro 2013",
      isActive: true,
      isStorefrontVisible: true,
      categoryName: "คอยล์ร้อน (Condenser)",
      carBrandName: "Mazda",
      carModelName: "BT-50 Pro",
      fitmentYear: 2013,
      skip: 0,
      take: 10,
    },
    { bypassInternalCaches: true },
  );
  report(
    Boolean(expected && result.ids.includes(expected.id)),
    `BT-50 Pro 2013 ต้องพบ P0080 (total=${result.total})`,
  );
}

async function run(): Promise<void> {
  console.log("Chat robustness golden suite — ตรวจกับแคตตาล็อกจริง\n" + "=".repeat(60));

  const terms = await loadCatalogTerms();
  console.log(`โหลดคำจากแคตตาล็อก ${terms.length} รายการ`);

  await checkTypoGuardNonCollision(terms);
  await checkTypoGuardOnRealQuestions(terms);
  await checkFoldKeepsCatalogTermsDistinct(terms);
  await checkFoldRecoveryAgainstEngine(terms);
  await checkFoldStaysDormant(terms);
  await checkVehicleSynonymLoop(terms);
  await checkCuratedEnglishCategoryAliases();
  await checkBt50ProFitmentRemediation();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`ผ่าน ${pass} / ${pass + fail}`);
  if (fail > 0) {
    console.log("ล้มเหลว:");
    for (const item of failures) console.log(`  - ${item}`);
    process.exitCode = 1;
  }
}

run()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
