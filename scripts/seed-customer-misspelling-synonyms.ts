/**
 * Adds the misspellings and alternate wordings real LINE customers type into the
 * existing SearchSynonym clusters they belong to — 7 clusters, 15 words.
 *
 * Follow-up to the 2026-08-03 "บล็อควาล์ว revo" incident (see
 * scripts/seed-expansion-valve-block-synonyms.ts). After fixing the valve
 * cluster, the same audit was run over every inbound LINE message (452 texts,
 * 7 Jun – 2 Aug 2026) plus the LineAiAuditLog search trail. Each word below was
 * verified THREE ways before earning a slot:
 *   1. a real customer typed it (or the chat classifier emitted it unrewritten),
 *   2. searchProductIdsV2 with that word + its category filter returned only a
 *      SUBSET of the category (the partial-match failure mode: the engine only
 *      broadens recall when the precise pass finds NOTHING, so an incomplete
 *      answer ships silently),
 *   3. the LLM classifier does NOT already correct it (words it fixes — มาร์ค,
 *      ดีแมด, มอเตอน์พัดลม — are deliberately absent; a synonym would spend a
 *      slot on a case that already works).
 *
 * Car-model words matter beyond query text: the fitment resolver grounds a
 * model mention through these same clusters, and "พัดลมโบซิ้ตี้ปี12" was read as
 * Isuzu DECA (!) in production because ซิ้ตี้ matched nothing.
 *
 * Measured and skipped, for the next auditor:
 *   - ไดรเออร์ → already 100% via trigram (ไดรเออร์↔ไดเออร์); lexeme counting
 *     said 0 but the engine covers it.
 *   - สายกลาง / สายใหญ่ → hose SUBTYPE names (liquid/suction line), not typos;
 *     a synonym would answer "สายใหญ่" with every hose.
 *   - พัดลมเป่า → ambiguous (customers meant 10"/14" condenser fans).
 *
 * Idempotent and additive: existing clusters only gain missing words, never
 * lose one. Dry run by default.
 *
 *   npm run seed:customer-misspelling-synonyms
 *   npm run seed:customer-misspelling-synonyms -- --apply
 */
import { db } from "@/lib/db";
import { MAX_SYNONYMS_PER_TERM } from "@/lib/search-synonyms";

/** canonical cluster term → words to add. Coverage = % of the category the word
 *  found on its own BEFORE this change (searchProductIdsV2, category-filtered). */
const ADDITIONS: Record<string, string[]> = {
  // ── โบลเวอร์ (Blower Motor, 54 SKUs) ──────────────────────────────────────
  //  โบว์เวอร์ 11% — typed twice ("โบว์เวอร์พัดลมแอร์ jazz ge" saw 5 of 12)
  //  พัดลมโบ  48% — typed 7 times, the most-typed wording in the whole audit
  พัดลมแอร์: ["โบว์เวอร์", "พัดลมโบ"],
  // ── คอยล์ร้อน (Condenser, 89 SKUs) ────────────────────────────────────────
  //  แผงคอยร้อน 11% — typed 6 times (dmax, คัมรี่, นาวาร่า, อัลติส, แจ็ค03)
  //  คอยร้อน   84% — typed 3 times
  คอยล์ร้อน: ["แผงคอยร้อน", "คอยร้อน"],
  // ── หน้าครัช (Compressor Clutch, 73 SKUs) — the มู่เล่ family had NO synonym
  //    coverage at all. มู่เล่/มู่เล่ย์ 33%, มูเล่ย์ 63% (the classifier itself
  //    emits this spelling), ชุดคลัช 37%. มูเล่ 95% / ชุดครัช 93% complete the
  //    ค↔ร spelling pairs the cluster already uses (หน้าคลัช/หน้าครัช).
  หน้าครัช: ["มู่เล่", "มูเล่", "มูเล่ย์", "มู่เล่ย์", "ชุดคลัช", "ชุดครัช"],
  // ── car models — ground the fitment resolver, not just the query text ─────
  //  แจ็ค: "แผงคอยร้อนฮอนด้าแจ็ค03" answered 2 of the 4 Jazz condensers.
  //  ฮอนด้าแจ็ค added too: the concatenated token never splits, so the bare
  //  form alone would not match it (same reason the cluster holds ฮอนด้าแจ๊ส).
  Jazz: ["แจ็ค", "ฮอนด้าแจ็ค"],
  //  ซิ้ตี้: "พัดลมโบซิ้ตี้ปี12" was resolved to Isuzu DECA in production.
  City: ["ซิ้ตี้"],
  //  ฟอจูเนอร์: "หม้อน้ำฟอจูเนอร์" answered 1 of the 2 Fortuner radiators.
  Fortuner: ["ฟอจูเนอร์"],
  //  ไฮเอด: "หม้อน้ำคอมมิวเตอร์ไฮเอด" — cluster has ไฮเอซ/ไฮเอช but not this.
  Hiace: ["ไฮเอด"],
};

const isApply = process.argv.includes("--apply");

async function main(): Promise<void> {
  const terms = Object.keys(ADDITIONS);
  const rows = await db.searchSynonym.findMany({
    where: { term: { in: terms } },
    select: { id: true, term: true, synonyms: true, isActive: true },
  });
  const byTerm = new Map(rows.map((row) => [row.term, row]));

  const missing = terms.filter((term) => !byTerm.has(term));
  if (missing.length > 0) {
    throw new Error(
      `no SearchSynonym row for: ${missing.join(", ")} — this script only updates existing clusters ` +
        "(master data is the shop's to own); check the term spelling against the DB.",
    );
  }

  let plannedUpdates = 0;
  const plan: Array<{ id: string; term: string; next: string[]; added: string[] }> = [];

  for (const term of terms) {
    const row = byTerm.get(term);
    if (!row) continue; // unreachable after the guard; keeps TS narrow
    const added = ADDITIONS[term].filter((word) => !row.synonyms.includes(word) && word !== term);
    const next = [...row.synonyms, ...added];

    console.log(`\n"${term}" (${row.synonyms.length} → ${next.length}/${MAX_SYNONYMS_PER_TERM})${row.isActive ? "" : "  ⚠ cluster ถูกปิดใช้งานอยู่"}`);
    console.log(`  + ${added.length > 0 ? added.join(", ") : "(มีครบแล้ว)"}`);

    if (next.length > MAX_SYNONYMS_PER_TERM) {
      throw new Error(
        `"${term}" would hold ${next.length} synonyms, over the cap of ${MAX_SYNONYMS_PER_TERM} — trim the list or raise the cap first.`,
      );
    }
    if (added.length > 0) {
      plan.push({ id: row.id, term, next, added });
      plannedUpdates += 1;
    }
  }

  if (plannedUpdates === 0) {
    console.log("\nไม่มีอะไรต้องเปลี่ยน (idempotent)");
    return;
  }

  if (!isApply) {
    console.log(`\n(dry run) จะอัปเดต ${plannedUpdates} คลัสเตอร์ — เพิ่ม -- --apply เพื่อบันทึกจริง`);
    return;
  }

  for (const entry of plan) {
    await db.searchSynonym.update({
      where: { id: entry.id },
      data: { synonyms: entry.next, isActive: true },
    });
  }

  console.log(`\n✓ บันทึกแล้ว ${plan.length} คลัสเตอร์`);
  console.log(
    "  หมายเหตุ: แคชคำพ้องมีอายุ 5 นาที (SYNONYM_CACHE_REVALIDATE ใน lib/search-synonyms.ts)\n" +
      "  ผลจะมีทันทีหลังแคชหมดอายุ หรือกดแก้/บันทึกที่หน้า ข้อมูลหลัก → คำพ้องการค้นหา เพื่อ revalidate ทันที",
  );
}

main()
  .catch((error: unknown) => {
    console.error("\nseed-customer-misspelling-synonyms failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void db.$disconnect();
  });
