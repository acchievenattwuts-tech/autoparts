import { db } from "../lib/db";

type SynonymSeed = {
  term: string;
  synonyms: string[];
  language?: string;
};

// Researched from Thai auto-parts storefronts and technical pages on 2026-05-21,
// with confirmed low-risk typo variants added for dropped vowels/marks and close consonant mistakes.
const seeds: SynonymSeed[] = [
  {
    term: "คอมแอร์",
    synonyms: [
      "คอมแอร์รถยนต์",
      "คอมเพรสเซอร์",
      "คอมเพรสเซอร์แอร์",
      "คอมเพรสเซอร์แอร์รถยนต์",
      "คอมเพรซเซอร์",
      "คอมแอ",
      "คอมแอร์รถยน",
      "คอมแอร์รถยนต",
      "คอมเพรสเซอร์แอ",
      "compressor",
      "compresser",
      "compresor",
      "air compressor",
      "ac compressor",
    ],
    language: "th",
  },
  {
    term: "คอยล์เย็น",
    synonyms: [
      "คอยเย็น",
      "คอยเยน",
      "คอยล์เยน",
      "คอยเย็นแอร์",
      "คอล์ยเย็น",
      "คอล์ยเยน",
      "ตู้แอร์",
      "ตู้แอ",
      "evaporator",
      "อีวาพอเรเตอร์",
      "อีวาโปเรเตอร์",
      "evaporater",
      "evap",
      "evaporator coil",
      "ac evaporator",
    ],
    language: "th",
  },
  {
    term: "คอยล์ร้อน",
    synonyms: [
      "คอนเดนเซอร์",
      "คอนเดนเซอ",
      "คอลเดนเซอร์",
      "คอลเดนเซอ",
      "แผงคอนเดนเซอร์",
      "รังผึ้งแอร์",
      "รังผึ้งแอ",
      "แผงแอร์",
      "condenser",
      "condensor",
      "air condenser",
      "ac condenser",
    ],
    language: "th",
  },
  {
    term: "ดรายเออร์",
    synonyms: [
      "ไดเออร์",
      "ไดรเออร์",
      "ไดเออ",
      "ดรายเออ",
      "รีซีฟเวอร์ดรายเออร์",
      "รีซีฟเวอร์ดรายเออ",
      "ตัวดูดความชื้น",
      "filter-dryer receiver",
      "dryer",
      "drier",
      "receiver dryer",
      "receiver drier",
      "filter drier",
    ],
    language: "th",
  },
  {
    term: "วาล์วแอร์",
    synonyms: [
      "วาวล์แอร์",
      "วาวแอร์",
      "วาวล์แอ",
      "บ๊อกวาล์วแอร์",
      "วาล์วตู้แอร์",
      "เอ็กซ์แพนชั่นวาล์ว",
      "เอ็กซ์แพนชันวาล์ว",
      "เอกแพนชั่นวาล์ว",
      "เอกแพนชันวาล์ว",
      "วาล์วขยาย",
      "expansion valve",
      "expantion valve",
      "expansion valv",
      "txv",
    ],
    language: "th",
  },
  {
    term: "พัดลมแอร์",
    synonyms: [
      "มอเตอร์พัดลมแอร์",
      "มอเตอร์พัดลมแอ",
      "โบเวอร์",
      "โบเวอ",
      "โบลเวอร์",
      "โบลเวอ",
      "พัดลมโบลเวอร์แอร์",
      "มอเตอร์โบลเวอร์",
      "blower",
      "blower motor",
      "blower fan",
      "air blower",
    ],
    language: "th",
  },
  {
    term: "น้ำยาแอร์",
    synonyms: ["สารทำความเย็น", "สารทําความเย็น", "น้ำยาแอ", "refrigerant", "r134a", "r-134a"],
    language: "th",
  },
  {
    term: "หม้อน้ำ",
    synonyms: [
      "หม้อน้ำรถยนต์",
      "หม้อน้ำรถยน",
      "หมอน้ำ",
      "หมอนํ้า",
      "ม้อน้ำ",
      "ม้อนํ้า",
      "รังผึ้งหม้อน้ำ",
      "รังผึ้งหมอน้ำ",
      "radiator",
      "raditor",
      "radiater",
      "radiator assy",
    ],
    language: "th",
  },
  {
    term: "ฝาหม้อน้ำ",
    synonyms: ["ฝาหม้อน้ำรถยนต์", "ฝาหม้อน้ำรถยน", "ฝาหมอน้ำ", "ฝาม้อน้ำ", "radiator cap", "rad cap", "cap radiator"],
    language: "th",
  },
  {
    term: "พัดลมหม้อน้ำ",
    synonyms: [
      "พัดลมหม้อน้ำรถยนต์",
      "พัดลมหมอน้ำ",
      "พัดลมม้อน้ำ",
      "พัดลมหม้อน้ำไฟฟ้า",
      "มอเตอร์พัดลมหม้อน้ำ",
      "มอเตอร์พัดลมหมอน้ำ",
      "มอเตอร์พัดลมระบายความร้อน",
      "radiator fan",
      "rad fan",
      "cooling fan",
      "cooling fan motor",
    ],
    language: "th",
  },
  {
    term: "น้ำยาหม้อน้ำ",
    synonyms: [
      "น้ำยาหล่อเย็น",
      "น้ำยาหล่อเยน",
      "น้ำยาหล่อเย็นหม้อน้ำ",
      "น้ำยาหล่อเย็นหมอน้ำ",
      "คูลแลนท์",
      "คูลแลน",
      "radiator coolant",
      "coolant",
      "coolent",
    ],
    language: "th",
  },
  {
    term: "ปั๊มน้ำรถยนต์",
    synonyms: [
      "ปั๊มน้ำ",
      "ปั้มน้ำ",
      "ปัมน้ำ",
      "ปั๊มนำ",
      "ปั้มนำ",
      "ปั้มน้ำรถยนต์",
      "ปั้มน้ำรถยน",
      "water pump",
      "waterpump",
      "w/pump",
      "wpump",
    ],
    language: "th",
  },
  {
    term: "เทอร์โมสตัท",
    synonyms: ["วาล์วน้ำ", "วาล์วนำ", "วาวน้ำ", "วาวล์น้ำ", "thermostat", "thermostate", "thermo stat"],
    language: "th",
  },
];

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

  return merged.slice(0, 10);
};

async function main() {
  let created = 0;
  let updated = 0;

  for (const seed of seeds) {
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
      updated += 1;
      continue;
    }

    await db.searchSynonym.create({
      data: {
        term,
        synonyms,
        language: seed.language ?? null,
        isActive: true,
      },
    });
    created += 1;
  }

  console.log(`Imported researched search synonyms. created=${created} updated=${updated}`);
}

main()
  .catch((error) => {
    console.error("Import failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
