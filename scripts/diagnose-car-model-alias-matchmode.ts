/**
 * READ-ONLY diagnostic: does a `CarModelAlias` table need a `matchMode`
 * (EXACT / CONTAINS / TOKEN) like `CategoryAlias`, or is EXACT-only correct?
 *
 * Answers it from the LIVE catalog + the live chat audit trail rather than from
 * intuition:
 *   1. How ambiguous are the real model names? A CONTAINS alias is only safe if no
 *      model name is a substring of another — otherwise "D-Max" swallows
 *      "All New D-Max" (or vice versa) and hard-filters the wrong generation.
 *   2. How short are they? A short name is what makes CONTAINS explode.
 *   3. How are the EXISTING sibling lookups (CarBrandAlias, SearchSynonym model
 *      clusters) keyed today? A new table should not invent a third convention.
 *   4. How big is the problem this table is meant to solve — how often does the
 *      classifier name a model that never becomes a hard filter?
 *
 * Writes nothing. Requires DATABASE_URL.
 *
 *   npx tsx --env-file=.env.local scripts/diagnose-car-model-alias-matchmode.ts
 */
import { db } from "@/lib/db";
import { normalizeSearchText } from "@/lib/search-normalization";
import { getThailandDateKey } from "@/lib/th-date";

const section = (title: string): void => {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);
};

async function main(): Promise<void> {
  // ── 1. Model-name ambiguity ────────────────────────────────────────────────
  section("1. ชื่อรุ่นรถจริงในระบบ — ความกำกวมถ้าใช้ CONTAINS");

  const models = await db.carModel.findMany({
    where: { isActive: true, carBrand: { isActive: true } },
    select: { name: true, carBrand: { select: { name: true } } },
  });
  console.log(`รุ่นรถที่ active: ${models.length} แถว`);

  type Row = { name: string; norm: string; brand: string };
  const rows: Row[] = models.map((row) => ({
    name: row.name,
    norm: normalizeSearchText(row.name),
    brand: row.carBrand.name,
  }));

  const containment: Array<{ shorter: Row; longer: Row; sameBrand: boolean }> = [];
  for (const a of rows) {
    for (const b of rows) {
      if (a === b || a.norm === b.norm) continue;
      if (b.norm.includes(a.norm)) {
        containment.push({ shorter: a, longer: b, sameBrand: a.brand === b.brand });
      }
    }
  }

  console.log(`คู่ที่ชื่อหนึ่ง "อยู่ใน" อีกชื่อ: ${containment.length} คู่`);
  const sameBrand = containment.filter((pair) => pair.sameBrand);
  console.log(`  - ยี่ห้อเดียวกัน: ${sameBrand.length} คู่ (อันตรายที่สุด — กรองผิดเจเนอเรชัน)`);
  console.log(`  - ข้ามยี่ห้อ:     ${containment.length - sameBrand.length} คู่`);
  for (const pair of containment.slice(0, 25)) {
    console.log(
      `    "${pair.shorter.name}" (${pair.shorter.brand}) ⊂ "${pair.longer.name}" (${pair.longer.brand})${
        pair.sameBrand ? "  ← ยี่ห้อเดียวกัน" : ""
      }`,
    );
  }
  if (containment.length > 25) console.log(`    ... อีก ${containment.length - 25} คู่`);

  // ── 2. Short names ─────────────────────────────────────────────────────────
  section("2. ชื่อรุ่นสั้น — ตัวที่ทำให้ CONTAINS ระเบิด");
  const byLength = new Map<number, string[]>();
  for (const row of rows) {
    const list = byLength.get(row.norm.length) ?? [];
    list.push(`${row.name} (${row.brand})`);
    byLength.set(row.norm.length, list);
  }
  for (const length of Array.from(byLength.keys()).sort((a, b) => a - b).slice(0, 5)) {
    const list = byLength.get(length) ?? [];
    console.log(`  ยาว ${length} ตัวอักษร: ${list.length} รุ่น — ${list.slice(0, 12).join(", ")}`);
  }

  // ── 3. How existing sibling lookups are keyed ─────────────────────────────
  section("3. ตารางพี่น้องที่มีอยู่แล้ว key ยังไง");
  const [brandAliasCount, brandAliasSample, synonymRows] = await Promise.all([
    db.carBrandAlias.count({ where: { isActive: true } }),
    db.carBrandAlias.findMany({
      where: { isActive: true },
      select: { alias: true, carBrand: { select: { name: true } } },
      take: 8,
    }),
    db.searchSynonym.findMany({
      where: { isActive: true },
      select: { term: true, synonyms: true },
    }),
  ]);
  console.log(`CarBrandAlias: ${brandAliasCount} แถว active — ไม่มีคอลัมน์ matchMode เลย`);
  console.log(
    `  ตัวอย่าง: ${brandAliasSample.map((row) => `"${row.alias}"→${row.carBrand.name}`).join(", ")}`,
  );

  const modelNorms = new Set(rows.map((row) => row.norm));
  const modelSynonyms = synonymRows.filter((row) => modelNorms.has(normalizeSearchText(row.term)));
  console.log(
    `SearchSynonym: ${synonymRows.length} คลัสเตอร์ · ที่ term ตรงกับชื่อรุ่นรถ = ${modelSynonyms.length}`,
  );
  const spellingCount = modelSynonyms.reduce(
    (sum, row) => sum + 1 + (row.synonyms?.length ?? 0),
    0,
  );
  console.log(`  รวมการสะกดที่รองรับอยู่แล้ว ${spellingCount} แบบ`);
  for (const row of modelSynonyms.slice(0, 8)) {
    console.log(`    "${row.term}" ← ${(row.synonyms ?? []).slice(0, 6).join(", ")}`);
  }

  // Would any EXISTING model spelling be dangerous as a CONTAINS alias?
  const allSpellings = modelSynonyms.flatMap((row) => [row.term, ...(row.synonyms ?? [])]);
  const dangerous = allSpellings.filter((spelling) => {
    const norm = normalizeSearchText(spelling);
    if (!norm) return false;
    return rows.some((row) => row.norm !== norm && row.norm.includes(norm));
  });
  console.log(
    `\nการสะกดที่ถ้าตั้งเป็น CONTAINS จะกลืนรุ่นอื่น: ${dangerous.length} / ${allSpellings.length}`,
  );
  console.log(`  ตัวอย่าง: ${Array.from(new Set(dangerous)).slice(0, 15).join(", ")}`);

  // ── 4. Size of the problem this table would solve ─────────────────────────
  section("4. ปัญหานี้ใหญ่แค่ไหน — classifier ระบุรุ่นแล้วแต่ resolve ไม่ได้");
  const consolidated = await db.lineAiAuditLog.findMany({
    where: { action: "SEARCH_QUERY_CONSOLIDATED" },
    select: { payload: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 3000,
  });
  console.log(`อ่าน SEARCH_QUERY_CONSOLIDATED ล่าสุด ${consolidated.length} แถว`);
  if (consolidated.length > 0) {
    const oldest = consolidated[consolidated.length - 1]?.createdAt;
    console.log(`  ช่วงเวลา: ${oldest ? getThailandDateKey(oldest) : "-"} → ปัจจุบัน`);
  }

  let resolvedModel = 0;
  let unresolvedModel = 0;
  const unresolvedSamples: string[] = [];
  for (const row of consolidated) {
    const payload = row.payload as {
      consolidatedQuery?: string | null;
      carModelName?: string | null;
      latestText?: string | null;
    } | null;
    if (!payload) continue;
    if (payload.carModelName) resolvedModel += 1;
    else {
      unresolvedModel += 1;
      const text = payload.latestText?.trim();
      if (text && unresolvedSamples.length < 400) unresolvedSamples.push(text);
    }
  }
  const total = resolvedModel + unresolvedModel;
  console.log(`  resolve รุ่นรถได้:    ${resolvedModel} (${((resolvedModel / total) * 100).toFixed(1)}%)`);
  console.log(`  resolve ไม่ได้:       ${unresolvedModel} (${((unresolvedModel / total) * 100).toFixed(1)}%)`);

  // Of the unresolved turns, how many actually NAME something close to a model?
  // (A turn with no vehicle at all is not what the alias table would fix.)
  const nearMisses = unresolvedSamples.filter((text) => {
    const norm = normalizeSearchText(text);
    return rows.some((row) => row.norm.length >= 4 && norm.includes(row.norm));
  });
  console.log(
    `\nจากเทิร์นที่ resolve ไม่ได้ ${unresolvedSamples.length} ตัวอย่าง:`,
  );
  console.log(
    `  มีชื่อรุ่นที่ "สะกดถูกเป๊ะ" อยู่ในข้อความ ${nearMisses.length} เทิร์น → เป็นปัญหาชั้นอื่น ไม่ใช่คำผิด`,
  );
  console.log(
    `  ที่เหลือ ${unresolvedSamples.length - nearMisses.length} เทิร์น = ไม่ได้เอ่ยรุ่น หรือสะกดไม่ตรงเลย (กลุ่มเป้าหมายของตารางนี้)`,
  );
  console.log("\n  ตัวอย่างข้อความที่ resolve รุ่นไม่ได้ (20 อันล่าสุด):");
  for (const text of unresolvedSamples.slice(0, 20)) {
    console.log(`    - ${text.replace(/\s+/g, " ").slice(0, 90)}`);
  }

  // ── 5. Existing CategoryAlias matchMode usage (is it even used?) ───────────
  section("5. CategoryAlias ใช้ matchMode กันจริงแค่ไหน (ตารางที่จะลอกแบบ)");
  const aliasRows = await db.categoryAlias.groupBy({
    by: ["matchMode", "kind", "isActive"],
    _count: { _all: true },
  });
  for (const row of aliasRows) {
    console.log(
      `  matchMode=${row.matchMode} kind=${row.kind} active=${row.isActive} → ${row._count._all} แถว`,
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
