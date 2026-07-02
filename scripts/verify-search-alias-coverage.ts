import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const normalizeSearchText = (value?: string | null) =>
  !value
    ? ""
    : value
        .normalize("NFC")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

const expectedTerms = [
  "ออนิวดีแม็ก",
  "วีครอส",
  "v-cross",
  "spacecab",
  "cab4",
  "hilux champ",
  "แชมป์",
  "imv 0",
  "rocco",
  "ร็อคโค่",
  "vigo champ",
  "วีโก้แชมป์",
  "ไมตี้เอ็กซ์",
  "yaris ativ",
  "ฮอนด้าฟิต",
  "เอ็นพี300",
  "pro-4x",
  "คาลิเบอร์",
  "ฟรอนเทียร์",
  "mega cab",
  "แอทลีท",
  "wildtrak",
  "แร็พเตอร์",
  "คอยล์ตู้",
  "อีแวป",
  "หม้อน้ำแอร์",
  "วาวแอร์",
  "exp valve",
  "กรองไดเออร์",
  "มอเตอร์ตู้",
  "พัดลมคอยล์ร้อน",
  "วาล์วหางคอม",
  "สายแอร์",
  "รังผึ้งน้ำ",
  "พูลเล่ย์คอม",
  "ยูดี",
  "โฟล์คสวาเกน",
  "โรเว่",
];

const main = async () => {
  const { db } = await import("../lib/db");
  const [brandAliases, carModels, categoryAliases, synonyms, keywords] = await Promise.all([
    db.carBrandAlias.findMany({ where: { isActive: true }, select: { alias: true } }),
    db.carModel.findMany({ where: { isActive: true }, select: { name: true } }),
    db.categoryAlias.findMany({ where: { isActive: true }, select: { alias: true } }),
    db.searchSynonym.findMany({ where: { isActive: true }, select: { term: true, synonyms: true } }),
    db.searchKeyword.findMany({ select: { term: true, normalized: true } }),
  ]);

  const covered = new Set<string>();
  const keywordCovered = new Set<string>();
  const add = (value?: string | null) => {
    const normalized = normalizeSearchText(value);
    if (normalized) covered.add(normalized);
  };

  for (const alias of brandAliases) add(alias.alias);
  for (const model of carModels) add(model.name);
  for (const alias of categoryAliases) add(alias.alias);
  for (const synonym of synonyms) {
    add(synonym.term);
    for (const value of synonym.synonyms) add(value);
  }
  for (const keyword of keywords) {
    add(keyword.term);
    add(keyword.normalized);
    keywordCovered.add(normalizeSearchText(keyword.term));
    keywordCovered.add(normalizeSearchText(keyword.normalized));
  }

  const missing = expectedTerms.filter((term) => !covered.has(normalizeSearchText(term)));
  const missingFromKeywordIndex = expectedTerms.filter((term) => !keywordCovered.has(normalizeSearchText(term)));
  console.log(JSON.stringify({ checked: expectedTerms.length, missing, missingFromKeywordIndex }, null, 2));

  if (missing.length > 0 || missingFromKeywordIndex.length > 0) {
    process.exitCode = 1;
  }

  await db.$disconnect();
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
