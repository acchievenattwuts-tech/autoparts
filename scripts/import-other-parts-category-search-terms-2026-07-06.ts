import { db } from "../lib/db";
import { normalizeSearchText } from "../lib/search-normalization";

type CategoryAliasSeed = {
  alias: string;
  priority: number;
  matchMode?: "EXACT" | "CONTAINS" | "TOKEN";
  notes: string;
};

type SynonymSeed = {
  term: string;
  synonyms: string[];
  language?: string;
};

const OTHER_PARTS_CATEGORY_NAME = "อะไหล่อื่นๆ";
const MAX_SYNONYMS_PER_TERM = 10;
const shouldApply = process.argv.includes("--apply");

const categoryAliasSeeds: CategoryAliasSeed[] = [
  { alias: "เทอร์โมแอร์", priority: 240, notes: "Other-parts resolver: A/C thermo products." },
  { alias: "เทอร์โมเซ็นเซอร์", priority: 240, notes: "Other-parts resolver: A/C thermo sensor products." },
  { alias: "หางเทอร์โม", priority: 235, notes: "Other-parts resolver: thermo tail/sensor harness products." },
  { alias: "สวิทช์เพรสเชอร์", priority: 240, notes: "Other-parts resolver: A/C pressure switch products." },
  { alias: "สวิตช์เพรสเชอร์", priority: 240, notes: "Other-parts resolver: A/C pressure switch spelling variant." },
  { alias: "เพรสเชอร์สวิทช์", priority: 235, notes: "Other-parts resolver: pressure switch word-order variant." },
  { alias: "เพรสเชอร์แอร์", priority: 230, notes: "Other-parts resolver: A/C pressure switch short customer term." },
  { alias: "สวิทช์พัดลมแอร์", priority: 230, notes: "Other-parts resolver: A/C fan switch products." },
  { alias: "สวิตช์พัดลมแอร์", priority: 230, notes: "Other-parts resolver: A/C fan switch spelling variant." },
  { alias: "รีเลย์", priority: 160, matchMode: "TOKEN", notes: "Other-parts resolver: relay token only to avoid overmatching long words." },
  { alias: "รีเลย์แอร์", priority: 220, notes: "Other-parts resolver: A/C relay products." },
  { alias: "รีเลย์เบรกไอเสีย", priority: 220, notes: "Other-parts resolver: exhaust brake relay product." },
  { alias: "เข็มขัดรัดท่อยาง", priority: 220, notes: "Other-parts resolver: hose clamp products." },
  { alias: "เข็มขัดรัดท่อ", priority: 220, notes: "Other-parts resolver: hose clamp products." },
  { alias: "เข็มขัดรัดสายยาง", priority: 220, notes: "Other-parts resolver: hose clamp products." },
  { alias: "แคล้มรัดท่อ", priority: 210, notes: "Other-parts resolver: hose clamp transliteration." },
  { alias: "แคลมป์รัดท่อ", priority: 210, notes: "Other-parts resolver: hose clamp transliteration." },
  { alias: "ท่อส่งลมแอร์", priority: 220, notes: "Other-parts resolver: flexible A/C air duct products." },
  { alias: "ท่อลมแอร์", priority: 220, notes: "Other-parts resolver: A/C air duct products." },
  { alias: "ท่อช่องลมแอร์", priority: 215, notes: "Other-parts resolver: A/C vent duct products." },
  { alias: "ตู้ฝัง", priority: 230, notes: "Other-parts resolver: embedded evaporator unit products." },
  { alias: "ตู้ฝังแอร์", priority: 230, notes: "Other-parts resolver: embedded A/C unit products." },
  { alias: "ตู้แขวน", priority: 210, notes: "Other-parts resolver: hanging A/C unit customer term." },
  { alias: "เปเปอร์", priority: 180, notes: "Other-parts resolver: paper type in embedded unit product names." },
  { alias: "เทปโฟม", priority: 210, notes: "Other-parts resolver: insulation foam tape products." },
  { alias: "เทปฉนวน", priority: 210, notes: "Other-parts resolver: insulation tape products." },
  { alias: "คอปเปอร์แอร์", priority: 190, notes: "Other-parts resolver: A/C quick coupler customer term." },
];

const synonymSeeds: SynonymSeed[] = [
  {
    term: "เทอร์โมแอร์",
    synonyms: ["เทอร์โม", "เทอร์โมเซ็นเซอร์", "หางเทอร์โม", "thermo amp", "thermistor"],
    language: "mixed",
  },
  {
    term: "สวิทช์เพรสเชอร์",
    synonyms: ["สวิตช์เพรสเชอร์", "เพรสเชอร์สวิทช์", "เพรสเชอร์สวิตช์", "เพรสเชอร์แอร์", "pressure switch"],
    language: "mixed",
  },
  {
    term: "สวิทช์พัดลมแอร์",
    synonyms: ["สวิตช์พัดลมแอร์", "สวิทพัดลมแอร์", "สวิตพัดลมแอร์", "fan switch"],
    language: "mixed",
  },
  {
    term: "รีเลย์แอร์",
    synonyms: ["รีเลย์", "รีเลย์พัดลมแอร์", "relay", "air relay"],
    language: "mixed",
  },
  {
    term: "รีเลย์เบรกไอเสีย",
    synonyms: ["รีเลย์เบรคไอเสีย", "รีเลย์เบรก", "รีเลย์เบรค", "exhaust brake relay"],
    language: "mixed",
  },
  {
    term: "เข็มขัดรัดท่อยาง",
    synonyms: ["เข็มขัดรัดท่อ", "เข็มขัดรัดสายยาง", "แคล้มรัดท่อ", "แคลมป์รัดท่อ", "hose clamp"],
    language: "mixed",
  },
  {
    term: "ท่อส่งลมแอร์",
    synonyms: ["ท่อลมแอร์", "ท่อช่องลมแอร์", "ท่อแอร์แบบยืด", "ท่อย่นแอร์", "air duct hose"],
    language: "mixed",
  },
  {
    term: "ตู้ฝังแอร์",
    synonyms: ["ตู้ฝัง", "ตู้แขวน", "ตู้แอร์ฝัง", "ตู้แอร์แขวน", "evaporator unit"],
    language: "mixed",
  },
  {
    term: "เทปฉนวน",
    synonyms: ["เทปโฟม", "เทปพันท่อแอร์", "เทปฉนวนแอร์", "insulation tape", "foam tape"],
    language: "mixed",
  },
  {
    term: "คอปเปอร์แอร์",
    synonyms: ["หัวคอปเปอร์", "หัวคอปเปอร์แอร์", "หัวเติมน้ำยาแอร์", "quick coupler"],
    language: "mixed",
  },
  {
    term: "ฝาปิดวาล์วเติมน้ำยาแอร์",
    synonyms: ["ฝาวาล์วแอร์", "ฝาปิดหัวเติมน้ำยา", "service port cap", "ac service cap"],
    language: "mixed",
  },
  {
    term: "ไส้ศรแอร์",
    synonyms: ["ไส้ลูกศรแอร์", "ศรแอร์", "ไส้วาล์วแอร์", "valve core", "ac valve core"],
    language: "mixed",
  },
  {
    term: "ตัวถอดไส้ศร",
    synonyms: ["ตัวถอดศรแอร์", "เครื่องมือถอดไส้ศร", "valve core remover"],
    language: "mixed",
  },
];

const clean = (value: string) => value.trim().replace(/\s+/g, " ");

const mergeSynonyms = ({
  existing,
  incoming,
  term,
  globallyUsed,
}: {
  existing: string[];
  incoming: string[];
  term: string;
  globallyUsed: Set<string>;
}) => {
  const normalizedTerm = normalizeSearchText(term);
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const value of [...existing, ...incoming]) {
    const trimmed = clean(value);
    const key = normalizeSearchText(trimmed);
    if (!trimmed || !key || key === normalizedTerm || seen.has(key)) continue;
    if (globallyUsed.has(key)) continue;
    seen.add(key);
    merged.push(trimmed);
  }

  return merged.slice(0, MAX_SYNONYMS_PER_TERM);
};

async function importCategoryAliases() {
  const category = await db.category.findUnique({
    where: { name: OTHER_PARTS_CATEGORY_NAME },
    select: { id: true, name: true },
  });
  if (!category) throw new Error(`Missing category: ${OTHER_PARTS_CATEGORY_NAME}`);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const changes: string[] = [];

  for (const seed of categoryAliasSeeds) {
    const alias = clean(seed.alias);
    const existing = await db.categoryAlias.findUnique({
      where: { alias_kind: { alias, kind: "SKIP_CATEGORY" } },
      select: { id: true, categoryId: true, matchMode: true, priority: true, isActive: true, notes: true },
    });
    const data = {
      categoryId: category.id,
      matchMode: seed.matchMode ?? "CONTAINS",
      priority: seed.priority,
      isActive: true,
      notes: seed.notes,
    } as const;

    if (!existing) {
      created += 1;
      changes.push(`category create: ${alias}`);
      if (shouldApply) {
        await db.categoryAlias.create({
          data: { alias, kind: "SKIP_CATEGORY", ...data },
        });
      }
      continue;
    }

    if (
      existing.categoryId === data.categoryId &&
      existing.matchMode === data.matchMode &&
      existing.priority === data.priority &&
      existing.isActive === data.isActive &&
      existing.notes === data.notes
    ) {
      skipped += 1;
      continue;
    }

    updated += 1;
    changes.push(`category update: ${alias}`);
    if (shouldApply) {
      await db.categoryAlias.update({ where: { id: existing.id }, data });
    }
  }

  return { created, updated, skipped, changes };
}

async function importSearchSynonyms() {
  const existingRows = await db.searchSynonym.findMany({
    select: { id: true, term: true, synonyms: true, language: true, isActive: true },
  });
  const valueToRow = new Map<string, (typeof existingRows)[number]>();
  const globallyUsed = new Set<string>();
  for (const row of existingRows) {
    const termKey = normalizeSearchText(row.term);
    valueToRow.set(termKey, row);
    globallyUsed.add(termKey);
    for (const synonym of row.synonyms) {
      const key = normalizeSearchText(synonym);
      valueToRow.set(key, row);
      globallyUsed.add(key);
    }
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const changes: string[] = [];

  for (const seed of synonymSeeds) {
    const members = [seed.term, ...seed.synonyms].map(clean).filter(Boolean);
    const target = members.map((member) => valueToRow.get(normalizeSearchText(member))).find(Boolean) ?? null;
    const term = target?.term ?? clean(seed.term);
    const scopedUsed = new Set(globallyUsed);
    if (target) {
      scopedUsed.delete(normalizeSearchText(target.term));
      for (const synonym of target.synonyms) scopedUsed.delete(normalizeSearchText(synonym));
    }
    const synonyms = mergeSynonyms({
      existing: target?.synonyms ?? [],
      incoming: members,
      term,
      globallyUsed: scopedUsed,
    });

    if (target) {
      if (
        target.isActive &&
        target.synonyms.length === synonyms.length &&
        target.synonyms.every((value, index) => value === synonyms[index])
      ) {
        skipped += 1;
        continue;
      }
      updated += 1;
      changes.push(`synonym update: ${target.term} -> ${synonyms.join(" | ")}`);
      if (shouldApply) {
        await db.searchSynonym.update({
          where: { id: target.id },
          data: { synonyms, language: target.language ?? seed.language ?? null, isActive: true },
        });
      }
    } else {
      created += 1;
      changes.push(`synonym create: ${term} -> ${synonyms.join(" | ")}`);
      if (shouldApply) {
        const row = await db.searchSynonym.create({
          data: { term, synonyms, language: seed.language ?? null, isActive: true },
        });
        for (const member of [term, ...synonyms]) {
          const key = normalizeSearchText(member);
          valueToRow.set(key, row);
          globallyUsed.add(key);
        }
      }
    }
  }

  return { created, updated, skipped, changes };
}

async function main() {
  const categoryResult = await importCategoryAliases();
  const synonymResult = await importSearchSynonyms();

  console.log(
    `${shouldApply ? "Applied" : "Dry-run"} other-parts search terms. ` +
      `categoryAliases created=${categoryResult.created} updated=${categoryResult.updated} skipped=${categoryResult.skipped}; ` +
      `searchSynonyms created=${synonymResult.created} updated=${synonymResult.updated} skipped=${synonymResult.skipped}`,
  );
  for (const change of [...categoryResult.changes, ...synonymResult.changes]) console.log(change);
}

main()
  .catch((error) => {
    console.error("Import failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
