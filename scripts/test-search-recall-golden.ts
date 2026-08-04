/**
 * Golden suite: search recall invariants against the REAL production catalog.
 *
 * Born from two 2026-08-03 incidents and the trgm_text candidate-arm migration:
 *   1. "บล็อควาล์ว revo" answered 1 of 2 matching SKUs — a customer wording that
 *      only partially overlaps the catalog produces an incomplete answer with no
 *      warning, because the engine widens recall only when the precise pass
 *      finds NOTHING. The fix was synonym-cluster coverage; this suite pins it.
 *   2. The fuzzy candidate arm moved from search_text (3KB, ~585ms/query) to the
 *      compact trgm_text column; this suite pins that fuzzy recall survived.
 *
 * Expectations are computed from the live catalog (never hardcoded counts), so
 * the suite stays green as products come and go — what it pins is COMPLETENESS:
 * every spelling a customer actually typed must reach the whole category it
 * refers to, and the documented production failures must return every matching
 * SKU their filters allow.
 *
 * Read-only. Requires DATABASE_URL (+ Gemini keys for the semantic path).
 *
 *   npm run test:search-recall-golden
 */
import { db } from "@/lib/db";
import { searchProductIdsV2 } from "@/lib/product-search";

const TAKE = 5;

type CategoryCoverageCase = {
  kind: "category-coverage";
  /** Every one of these customer spellings... */
  queries: string[];
  /** ...must reach EVERY active product in this category. */
  categoryName: string;
  note: string;
};

type FilteredCompletenessCase = {
  kind: "filtered-completeness";
  query: string;
  categoryName: string;
  carBrandName: string;
  carModelName: string;
  /** Model-name fragment for the live ground-truth count. */
  modelContains: string;
  note: string;
};

type FuzzyRescueCase = {
  kind: "fuzzy-rescue";
  query: string;
  /** At least one returned product name must match. */
  expectAnyName: RegExp;
  note: string;
};

type MustIncludeCase = {
  kind: "must-include";
  query: string;
  categoryName: string;
  carBrandName: string;
  carModelName: string;
  mustIncludeCodes: string[];
  note: string;
};

type GoldenCase = CategoryCoverageCase | FilteredCompletenessCase | FuzzyRescueCase | MustIncludeCase;

const CASES: GoldenCase[] = [
  // ── incident 2026-08-03: the exact turn, must return BOTH SKUs ─────────────
  {
    kind: "must-include",
    query: "บล็อควาล์ว revo",
    categoryName: "วาล์ว (Expansion Valve)",
    carBrandName: "Toyota",
    carModelName: "Hilux Revo",
    mustIncludeCodes: ["P0093", "P0362"],
    note: "LINE 2026-08-03: answered P0093 only, P0362 (DENSO) was silently missing",
  },
  // ── every customer-typed spelling reaches its whole category ───────────────
  {
    kind: "category-coverage",
    categoryName: "วาล์ว (Expansion Valve)",
    queries: [
      "วาล์วแอร์", "วาวล์แอร์", "บล็อควาล์ว", "บล็อกวาล์ว", "วาล์วบล็อก", "วาล์วบล็อค",
      "วาล์วบล๊อก", "บ๊อกวาล์ว", "บล๊อกวาล์ว", "บล๊อควาล์ว", "วาล์วบล๊อค",
      "วาว์ลแอร์", "วาว์ล", "วาว์ว",
    ],
    note: "block-valve + วาว์ล families (synonym cluster, 2026-08-03)",
  },
  {
    kind: "category-coverage",
    categoryName: "โบเวอร์ พัดลมแอร์ (Blower Motor)",
    queries: ["โบลเวอร์", "โบเวอร์", "โบว์เวอร์", "พัดลมโบ", "พัดลมแอร์"],
    note: "โบว์เวอร์ was 11%, พัดลมโบ (typed 7x) was 48%",
  },
  {
    kind: "category-coverage",
    categoryName: "คอยล์ร้อน (Condenser)",
    queries: ["คอยล์ร้อน", "แผงแอร์", "แผงคอยร้อน", "คอยร้อน", "คอนเดนเซอร์"],
    note: "แผงคอยร้อน (typed 6x) was 11%",
  },
  {
    kind: "category-coverage",
    categoryName: "หน้าครัช (Compressor Clutch)",
    queries: ["หน้าครัช", "หน้าคลัช", "มู่เล่", "มูเล่", "มูเล่ย์", "มู่เล่ย์", "ชุดคลัช", "ชุดครัช"],
    note: "the มู่เล่ family had no synonym coverage at all",
  },
  {
    kind: "category-coverage",
    categoryName: "ดรายเออร์ (Drier / Receiver Drier)",
    queries: ["ดรายเออร์", "ไดเออร์", "ไดรเออร์"],
    note: "ไดรเออร์ is covered by trigram alone (no synonym) — pins that the trgm_text arm still rescues it",
  },
  // ── documented production failures with their real filters ────────────────
  {
    kind: "filtered-completeness",
    query: "แผงคอยร้อน ฮอนด้าแจ็ค",
    categoryName: "คอยล์ร้อน (Condenser)",
    carBrandName: "Honda",
    carModelName: "Jazz",
    modelContains: "Jazz",
    note: "production answered 2 of 4 (customer spelled Jazz as แจ็ค)",
  },
  {
    kind: "filtered-completeness",
    query: "หม้อน้ำ ฟอจูเนอร์",
    categoryName: "หม้อน้ำ (Radiator)",
    carBrandName: "Toyota",
    carModelName: "Fortuner",
    modelContains: "Fortuner",
    note: "production answered 1 of 2",
  },
  {
    kind: "filtered-completeness",
    query: "พัดลมโบ ซิ้ตี้",
    categoryName: "โบเวอร์ พัดลมแอร์ (Blower Motor)",
    carBrandName: "Honda",
    carModelName: "City",
    modelContains: "City",
    note: "production resolved ซิ้ตี้ to Isuzu DECA and answered 1 of 4",
  },
  // ── fuzzy (trigram-arm) rescues — the recall path trgm_text must preserve ──
  {
    kind: "fuzzy-rescue",
    query: "หม้อนำ วีออส",
    expectAnyName: /หม้อน้ำ/,
    note: "dropped ้ — no synonym covers this; only the trigram arm rescues it",
  },
  {
    kind: "fuzzy-rescue",
    query: "คอล์ยเย็น แจ๊ส",
    expectAnyName: /(คอยล์เย็น|คอยเย็น|ตู้แอร์)/,
    note: "transposed การันต์ (typed by a real customer as คอล์ยเย็นนิสสันมาร์ค)",
  },
  {
    kind: "fuzzy-rescue",
    query: "มอเตอพัดลม vios",
    expectAnyName: /(มอเตอร์|พัดลม)/,
    note: "dropped ร์ mid-word (typed by a real customer as มอเตอพัดลม แครี่)",
  },
];

let pass = 0;
let fail = 0;
const failures: string[] = [];

const report = (ok: boolean, label: string): void => {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
};

async function run(): Promise<void> {
  for (const c of CASES) {
    if (c.kind === "category-coverage") {
      const all = await db.product.count({
        where: { isActive: true, isStorefrontVisible: true, category: { name: c.categoryName } },
      });
      console.log(`\n[coverage] ${c.categoryName} — ${all} SKUs (${c.note})`);
      for (const q of c.queries) {
        const r = await searchProductIdsV2(
          { query: q, isActive: true, isStorefrontVisible: true, categoryName: c.categoryName, skip: 0, take: TAKE },
          { bypassInternalCaches: true },
        );
        report(r.total === all, `"${q}" → ${r.total}/${all}`);
      }
    } else if (c.kind === "filtered-completeness") {
      const expected = await db.product.count({
        where: {
          isActive: true,
          isStorefrontVisible: true,
          category: { name: c.categoryName },
          carModels: { some: { carModel: { name: { contains: c.modelContains } } } },
        },
      });
      const r = await searchProductIdsV2(
        {
          query: c.query,
          isActive: true,
          isStorefrontVisible: true,
          categoryName: c.categoryName,
          carBrandName: c.carBrandName,
          carModelName: c.carModelName,
          skip: 0,
          take: 10,
        },
        { bypassInternalCaches: true },
      );
      console.log(`\n[filtered] ${c.note}`);
      report(r.total >= expected, `"${c.query}" → ${r.total} (ต้อง ≥ ${expected})`);
    } else if (c.kind === "must-include") {
      const r = await searchProductIdsV2(
        {
          query: c.query,
          isActive: true,
          isStorefrontVisible: true,
          categoryName: c.categoryName,
          carBrandName: c.carBrandName,
          carModelName: c.carModelName,
          skip: 0,
          take: 10,
        },
        { bypassInternalCaches: true },
      );
      const rows = await db.product.findMany({
        where: { id: { in: r.ids } },
        select: { code: true },
      });
      const codes = new Set(rows.map((row) => row.code));
      console.log(`\n[must-include] ${c.note}`);
      for (const code of c.mustIncludeCodes) {
        report(codes.has(code), `"${c.query}" ต้องมี ${code}`);
      }
    } else {
      const r = await searchProductIdsV2(
        { query: c.query, isActive: true, isStorefrontVisible: true, skip: 0, take: TAKE },
        { bypassInternalCaches: true },
      );
      const rows = await db.product.findMany({ where: { id: { in: r.ids } }, select: { name: true } });
      const hit = rows.some((row) => c.expectAnyName.test(row.name));
      console.log(`\n[fuzzy] ${c.note}`);
      report(r.total > 0 && hit, `"${c.query}" → ${r.total} รายการ, on-topic=${hit}`);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`ผ่าน ${pass} / ${pass + fail}`);
  if (fail > 0) {
    console.log("ล้มเหลว:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

run()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
