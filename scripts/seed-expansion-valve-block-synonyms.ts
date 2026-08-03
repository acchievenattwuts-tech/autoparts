/**
 * Rebuilds the "วาล์วแอร์" (Expansion Valve) synonym cluster so the block-valve
 * spellings Thai buyers actually type resolve to the whole category.
 *
 * Why: on 2026-08-03 a LINE customer asked "บล็อควาล์ว revo". The catalog holds
 * two matching SKUs (P0093 STAL, P0362 DENSO) but the reply carried only P0093 —
 * the literal lexeme "บล็อควาล์ว" exists in just 5 of the 47 valve SKUs' keyword
 * text, and no synonym bridged it to "วาล์วแอร์" (the one term that covers all
 * 47). The precise AND query matched a single row, and because the broad OR
 * fallback in lib/product-search.ts only fires when AND returns ZERO rows, the
 * incomplete result was never widened. Same for semantic recall, which is gated
 * on an empty lexical pass.
 *
 * Grounded in production: every spelling below was checked against
 * product_search_documents for how many SKUs it reaches today (the "reach"
 * comments). Words with reach 0 are the valuable ones — they are what a customer
 * types and the catalog does not contain.
 *
 * This script REPLACES the cluster rather than merging, because four low-value
 * entries had to make room (the cluster was full). Removals are printed in the
 * dry run — read them before applying.
 *
 * Depends on MAX_SYNONYMS_PER_TERM being raised to 18 in lib/search-synonyms.ts;
 * the admin Server Action rejects anything above it, and expandQueryTokenGroups
 * truncates a concept's cluster at MAX_SYNONYMS_PER_TERM + 1 when searching.
 * Re-running this script is safe: it is idempotent and reports the exact diff.
 *
 *   npx tsx --env-file=.env.local scripts/seed-expansion-valve-block-synonyms.ts
 *   npx tsx --env-file=.env.local scripts/seed-expansion-valve-block-synonyms.ts -- --apply
 */
import { db } from "@/lib/db";
import { MAX_SYNONYMS_PER_TERM } from "@/lib/search-synonyms";

const TERM = "วาล์วแอร์";

/**
 * The cluster as it should stand — 18 entries, at the cap.
 *
 * Nothing here is filler. Thai tone marks survive normalization
 * (lib/search-normalization.ts lowercases and collapses whitespace/joiners only),
 * so every spelling below is a distinct lookup key that has to be spelled out to
 * work: "วาวล์แอร์" already covered 47/47 SKUs while "วาว์ลแอร์" — the same word
 * with the ทัณฑฆาต one letter earlier — reached only 30/47.
 *
 * "coverage" = how much of the 47-SKU valve category a customer typing that word
 * actually got back, measured against production before this change. Anything
 * below 100% is an incomplete answer, which is the exact defect being fixed: the
 * search only widens its recall when the precise pass finds NOTHING, so a partial
 * match is never rescued.
 */
const SYNONYMS: string[] = [
  // ── kept from the previous cluster ────────────────────────────────────────
  "วาวล์แอร์", // 100% — the most common typo of the category name
  "วาวแอร์", // 100%
  "เอ็กซ์แพนชั่นวาล์ว", // the technical name
  "วาล์วตู้แอร์",
  "เอ็กซ์แพนชันวาล์ว", // same word missing ไม้เอก
  "เอกแพนชั่นวาล์ว", // same word missing ซ์
  // ── block-valve family — the 2026-08-03 incident ──────────────────────────
  "บล็อควาล์ว", // 11% — the exact wording the customer sent
  "บล็อกวาล์ว", // 57%
  "วาล์วบล็อก", // 64%
  "วาล์วบล็อค", // 9%
  "วาล์วบล๊อก", // 17%
  "บ๊อกวาล์ว", // 2% — a different word ("box"), not a spelling permutation
  "บล๊อกวาล์ว", // 4%
  "บล๊อควาล์ว", // 6%
  "วาล์วบล๊อค", // 9%
  // ── "วาว์ล" family — found by auditing 2 months of inbound LINE messages ──
  // The ทัณฑฆาต lands on ว instead of ล. Four customers wrote it (the most-typed
  // valve misspelling in the data) and, unlike "วาว" / "วาร์ว", the chat
  // classifier does NOT correct it — it passes the misspelling straight to the
  // search, which then answered from 64% of the category.
  "วาว์ลแอร์", // 64% — the exact token the classifier emits
  "วาว์ล", // 53% — the bare form
  "วาว์ว", // 0% — "วาว์วนิสสันมาร์ช"; matched nothing at all
];

/**
 * Considered and left out, with the reason. Kept in the source (not just git
 * history) so the next editor does not re-litigate the same calls.
 *
 *  - "บ๊อกวาล์วแอร์"   → long form; the shorter "บ๊อกวาล์ว" replaces it
 *  - "วาวล์แอ"        → truncated typo, far rarer than the spellings kept
 *  - "เอกแพนชันวาล์ว"  → double misspelling; both single-error forms are kept
 *  - "วาล์วขยาย"      → literal translation of "expansion valve"; never seen in
 *                        any inbound chat or search log
 *  - "วาว" / "วาร์ว"  → the chat classifier already rewrites these to "วาล์วแอร์"
 *                        before the search runs (verified in LineAiAuditLog:
 *                        "วาววีออส" → 13 results, "วาร์วแอร์" → 9), so a synonym
 *                        would spend a slot on a case that already works.
 */
const INTENTIONALLY_DROPPED = ["บ๊อกวาล์วแอร์", "วาวล์แอ", "เอกแพนชันวาล์ว", "วาล์วขยาย"];

const isApply = process.argv.includes("--apply");

async function main(): Promise<void> {
  if (SYNONYMS.length > MAX_SYNONYMS_PER_TERM) {
    throw new Error(
      `cluster has ${SYNONYMS.length} synonyms but MAX_SYNONYMS_PER_TERM is ${MAX_SYNONYMS_PER_TERM}. ` +
        "Raise the cap in lib/search-synonyms.ts (and its mirror in SearchSynonymsClient.tsx) or trim the list.",
    );
  }

  const duplicates = SYNONYMS.filter((value, index) => SYNONYMS.indexOf(value) !== index);
  if (duplicates.length > 0) {
    throw new Error(`duplicate synonyms in the list: ${duplicates.join(", ")}`);
  }

  const existing = await db.searchSynonym.findFirst({
    where: { term: TERM },
    select: { id: true, term: true, synonyms: true, language: true, isActive: true },
  });

  if (!existing) {
    throw new Error(
      `no SearchSynonym row with term "${TERM}". This script updates the existing cluster ` +
        "rather than creating one — master data is the shop's to own.",
    );
  }

  const before = existing.synonyms;
  const added = SYNONYMS.filter((value) => !before.includes(value));
  const removed = before.filter((value) => !SYNONYMS.includes(value));

  console.log(`\nคลัสเตอร์คำพ้อง: "${TERM}"  (เพดานปัจจุบัน ${MAX_SYNONYMS_PER_TERM} คำ)`);
  console.log(`  ก่อน : ${before.length} คำ — ${before.join(", ")}`);
  console.log(`  หลัง : ${SYNONYMS.length} คำ — ${SYNONYMS.join(", ")}`);
  console.log(`\n  + เพิ่ม ${added.length} คำ: ${added.join(", ") || "(ไม่มี)"}`);
  console.log(`  - ลบ   ${removed.length} คำ: ${removed.join(", ") || "(ไม่มี)"}`);

  const unexpectedRemovals = removed.filter((value) => !INTENTIONALLY_DROPPED.includes(value));
  if (unexpectedRemovals.length > 0) {
    console.warn(
      `\n  ⚠ คำที่ถูกลบโดยไม่ได้อยู่ในรายการที่ตั้งใจลบ: ${unexpectedRemovals.join(", ")}` +
        "\n    แปลว่ามีคนแก้คลัสเตอร์นี้หลังจากสคริปต์ถูกเขียน — ตรวจก่อนรัน --apply",
    );
  }

  if (added.length === 0 && removed.length === 0) {
    console.log("\nไม่มีอะไรต้องเปลี่ยน (idempotent)");
    return;
  }

  if (!isApply) {
    console.log("\n(dry run) เพิ่ม -- --apply เพื่อบันทึกจริง");
    return;
  }

  await db.searchSynonym.update({
    where: { id: existing.id },
    data: { synonyms: SYNONYMS, isActive: true },
  });

  console.log("\n✓ บันทึกแล้ว");
  console.log(
    "  หมายเหตุ: แคชคำพ้องมีอายุ 5 นาที (SYNONYM_CACHE_REVALIDATE ใน lib/search-synonyms.ts)\n" +
      "  ผลจะมีทันทีหลังแคชหมดอายุ หรือกดแก้/บันทึกที่หน้า ข้อมูลหลัก → คำพ้องการค้นหา เพื่อ revalidate ทันที",
  );
}

main()
  .catch((error: unknown) => {
    console.error("\nseed-expansion-valve-block-synonyms failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void db.$disconnect();
  });
