import { db } from "../lib/db";

type SynonymSeed = {
  term: string;
  synonyms: string[];
  language?: string;
};

const MAX_SYNONYMS_PER_TERM = 64;

const brandSynonyms: Record<string, string[]> = {
  Chevrolet: ["เชฟโรเลต", "เชฟโรเลท", "เชฟ", "chevy"],
  Ford: ["ฟอร์ด", "ฟอด"],
  Honda: ["ฮอนด้า", "ฮอนดา"],
  Isuzu: ["อีซูซุ", "อีซูสุ", "อิซูซุ", "อิซูสุ", "isusu"],
  Mazda: ["มาสด้า", "มาสดา"],
  MG: ["เอ็มจี", "เอมจี"],
  Mitsubishi: ["มิตซูบิชิ", "มิซูบิชิ", "มิตซู", "mitsubisi"],
  Nissan: ["นิสสัน", "นิสัน"],
  Roewe: ["โรวี", "โรวี่", "โรเว่"],
  Suzuki: ["ซูซูกิ", "ซูซูกี้", "ซูซุกิ"],
  Toyota: ["โตโยต้า", "โตโยตา", "toyata"],
  UD: ["ยูดี", "ยูดีทรัค", "ud truck", "ud trucks"],
  Volkswagen: ["โฟล์ค", "โฟล์ก", "โฟล์คสวาเกน", "โฟล์กสวาเกน", "vw"],
};

const modelSynonyms: Record<string, string[]> = {
  Accord: ["แอคคอร์ด", "แอคคอด", "แอคคอร์ดฮอนด้า"],
  Almera: ["อัลเมร่า", "อัลเมรา", "อัลเมล่า", "อัลเมล่า"],
  Attrage: ["แอททราจ", "แอททราจน์", "แอทตราจ", "แอทเทรจ"],
  "BT-50": ["BT50", "บีที50", "บีที-50", "บีทีห้าสิบ"],
  BRV: ["BR-V", "บีอาร์วี", "บีอาร์-วี"],
  Camry: ["แคมรี่", "แคมรี", "แคมรี่โตโยต้า"],
  Carry: ["แครี่", "แครี", "แครี่ซูซูกิ"],
  CHR: ["C-HR", "ซีเอชอาร์", "ซีเอช-อาร์", "ซีเฮชอาร์"],
  Ciaz: ["เซียส", "เซียซ", "ซีแอซ"],
  City: ["ซิตี้", "ซิตี", "ฮอนด้าซิตี้", "honda city"],
  Civic: ["ซีวิค", "ซีวิก", "ฮอนด้าซีวิค", "honda civic"],
  Colorado: ["โคโลราโด", "โคโลลาโด", "โคโลราโด้"],
  Corolla: ["โคโรลล่า", "โคโรลลา", "อัลติส", "Altis", "โคโรล่า"],
  CRV: ["CR-V", "ซีอาร์วี", "ซีอาร์-วี", "ซีอาวี"],
  "CX-3": ["CX3", "ซีเอ็กซ์3", "ซีเอ็กซ์-3"],
  "CX-5": ["CX5", "ซีเอ็กซ์5", "ซีเอ็กซ์-5"],
  "D-Max": [
    "DMax",
    "D Max",
    "ดีแม็ก",
    "ดีแมค",
    "ดีแม๊ก",
    "ดีแมก",
    "ดีแม็กซ์",
    "ออนิว",
    "ออลนิว",
    "All New",
    "All New D-Max",
    "ออนิวดีแม็ก",
    "ออนิวดีแมค",
    "ดีแม็กออนิว",
    "ดีแมคออนิว",
    "allnew dmax",
    "dmax all new",
    "d-max all new",
    "v-cross",
    "vcross",
    "วีครอส",
    "ไฮแลนเดอร์",
    "hi-lander",
    "spark",
    "spacecab",
    "space cab",
    "cab4",
  ],
  Ertiga: ["เออร์ติก้า", "เออติก้า", "เออร์ติกา"],
  Everest: ["เอเวอเรสต์", "เอเวอร์เรส", "เอเวอเรส"],
  Festa: ["Fiesta", "เฟียสต้า", "เฟียสตา", "ฟิเอสต้า"],
  Fortuner: ["ฟอร์จูนเนอร์", "ฟอร์จูนเนอ", "ฟอจูนเนอร์", "ฟอร์จูน"],
  Frontier: ["ฟรอนเทียร์", "ฟรอนเทีย", "ฟ้อนเทีย", "frontier navara"],
  "Hilux Revo": [
    "Revo",
    "รีโว่",
    "รีโว",
    "รีโว้",
    "ไฮลักซ์รีโว่",
    "ไฮลักซ์ รีโว่",
    "ไฮลักรีโว",
    "Hilux",
    "hilux revo",
    "rocco",
    "ร็อคโค่",
    "ร็อคโค",
    "รอคโค",
    "gr sport",
    "gr-s",
    "จีอาร์สปอร์ต",
  ],
  "Hilux Vigo": ["Vigo", "วีโก้", "วีโก", "Hilux Vigo", "vigo champ", "วีโก้แชมป์", "วีโกแชมป์"],
  "Hilux Mighty-X": ["Mighty X", "MightyX", "ไมตี้เอ็กซ์", "ไมตี้เอ๊กซ์", "ไมตี้x"],
  "Hilux Champ": ["Champ", "แชมป์", "ไฮลักซ์แชมป์", "IMV 0", "IMV0"],
  HRV: ["HR-V", "เอชอาร์วี", "เอชอาร์-วี"],
  Jazz: ["แจ๊ส", "แจส", "ฮอนด้าแจ๊ส", "fit", "honda fit", "ฟิต", "ฮอนด้าฟิต"],
  March: ["มาร์ช", "มาช", "นิสสันมาร์ช"],
  Mazda2: ["Mazda 2", "มาสด้า2", "มาสด้า 2", "มาสด้าสอง"],
  Mazda3: ["Mazda 3", "มาสด้า3", "มาสด้า 3", "มาสด้าสาม"],
  MG3: ["MG 3", "เอ็มจี3", "เอ็มจี 3"],
  MG5: ["MG 5", "เอ็มจี5", "เอ็มจี 5"],
  "MG HS": ["MGHS", "เอ็มจีเอชเอส", "เอ็มจี HS"],
  "MG ZS": ["MGZS", "เอ็มจีแซดเอส", "เอ็มจี ZS"],
  "MU-X": ["MUX", "MU X", "มิวเอ็กซ์", "มิวเอ็ก", "มิวเอ็กซ์อีซูซุ"],
  Navara: [
    "นาวาร่า",
    "นาวารา",
    "นาวาร่านิสสัน",
    "np300 navara",
    "calibre",
    "คาลิเบอร์",
    "pro-4x",
    "pro4x",
    "โปรโฟร์เอ็กซ์",
    "king cab",
    "single cab",
  ],
  NP300: ["NP 300", "เอ็นพี 300", "เอ็นพี300", "เอ็นพีสามร้อย", "NP300 Navara"],
  Note: ["โน๊ต", "โน้ต", "นิสสันโน๊ต"],
  "Pajero Sport": ["Pajero", "ปาเจโร่", "ปาเจโร", "ปาเจโร่สปอร์ต", "ปาเจโรสปอร์ต", "แพเจโร่"],
  Ranger: [
    "เรนเจอร์",
    "เรนเจอ",
    "เรนเจอร์ฟอร์ด",
    "wildtrak",
    "ไวลด์แทรค",
    "แรพเตอร์",
    "แร็พเตอร์",
    "raptor",
    "ranger raptor",
  ],
  RAV4: ["RAV 4", "ราฟ4", "ราฟ 4", "อาร์เอวี4"],
  Swift: ["สวิฟท์", "สวิฟ", "สวิฟต์"],
  Terra: ["เทอร์ร่า", "เทอร่า", "เทอร์รา"],
  Trailblazer: ["เทรลเบลเซอร์", "เทรลเบลเซอ", "เทลเบลเซอร์"],
  Triton: [
    "ไทรทัน",
    "ไตรตัน",
    "ไทรตั้น",
    "ไทรทั่น",
    "ไตรทั่น",
    "triton mega cab",
    "mega cab",
    "เมกะแค็บ",
    "เมกะแคป",
    "athlete",
    "แอทลีท",
    "black edition",
  ],
  Vios: ["วีออส", "วีออสโตโยต้า", "โตโยต้าวีออส"],
  "X-Trail": ["XTrail", "X Trail", "เอ็กซ์เทรล", "เอ็กเทรล"],
  Xpander: ["เอ็กซ์แพนเดอร์", "เอ็กแพนเดอร์", "เอ็กซ์แพนเดอ"],
  Yaris: ["ยาริส", "ยาริช", "โตโยต้ายาริส", "yaris ativ", "ativ", "ยาริสเอทีฟ", "ยาริส ativ", "เอทีฟ"],
};

const normalize = (value: string) => value.trim();

const mergeSynonyms = (existing: string[], incoming: string[], term: string) => {
  const lowerTerm = term.toLowerCase();
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const value of [...incoming, ...existing]) {
    const clean = normalize(value);
    const key = clean.toLowerCase();
    if (!clean || key === lowerTerm || seen.has(key)) continue;
    seen.add(key);
    merged.push(clean);
  }

  return merged.slice(0, MAX_SYNONYMS_PER_TERM);
};

async function upsertSynonym(seed: SynonymSeed) {
  const term = normalize(seed.term);
  const existing = await db.searchSynonym.findUnique({ where: { term } });
  const synonyms = mergeSynonyms(existing?.synonyms ?? [], seed.synonyms, term);

  if (existing) {
    await db.searchSynonym.update({
      where: { id: existing.id },
      data: {
        synonyms,
        language: existing.language ?? seed.language ?? null,
        isActive: true,
      },
    });
    return "updated" as const;
  }

  await db.searchSynonym.create({
    data: {
      term,
      synonyms,
      language: seed.language ?? null,
      isActive: true,
    },
  });
  return "created" as const;
}

async function main() {
  const brands = await db.carBrand.findMany({
    where: { isActive: true },
    include: {
      carModels: {
        where: { isActive: true },
        select: { name: true },
        orderBy: { name: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;

  const seeds: SynonymSeed[] = [];
  for (const brand of brands) {
    const synonyms = brandSynonyms[brand.name] ?? [];
    if (synonyms.length > 0) seeds.push({ term: brand.name, synonyms, language: "mixed" });

    for (const model of brand.carModels) {
      const modelAliases = modelSynonyms[model.name] ?? [];
      const brandAliases = [brand.name, ...(brandSynonyms[brand.name] ?? []).slice(0, 2)];
      const combined = [...modelAliases, ...brandAliases.map((alias) => `${alias} ${model.name}`)];
      if (combined.length > 0) seeds.push({ term: model.name, synonyms: combined, language: "mixed" });
    }
  }

  for (const seed of seeds) {
    if (seed.synonyms.length === 0) {
      skipped += 1;
      continue;
    }

    const result = await upsertSynonym(seed);
    if (result === "created") created += 1;
    if (result === "updated") updated += 1;
  }

  console.log(
    `Imported car search synonyms. brands=${brands.length} seeds=${seeds.length} created=${created} updated=${updated} skipped=${skipped}`,
  );
}

main()
  .catch((error) => {
    console.error("Import failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
