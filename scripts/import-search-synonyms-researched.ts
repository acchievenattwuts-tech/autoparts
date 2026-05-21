import { db } from "../lib/db";

type SynonymSeed = {
  term: string;
  synonyms: string[];
  language?: string;
};

// Researched from Thai auto-parts storefronts and technical pages on 2026-05-21.
// Keep this list conservative: only import terms seen in source pages, not guessed SEO variants.
const seeds: SynonymSeed[] = [
  {
    term: "คอมแอร์",
    synonyms: [
      "คอมแอร์รถยนต์",
      "คอมเพรสเซอร์",
      "คอมเพรสเซอร์แอร์",
      "คอมเพรสเซอร์แอร์รถยนต์",
      "คอมเพรซเซอร์",
      "compressor",
    ],
    language: "th",
  },
  {
    term: "คอยล์เย็น",
    synonyms: ["คอยเย็น", "คอล์ยเย็น", "ตู้แอร์", "evaporator", "อีวาพอเรเตอร์", "อีวาโปเรเตอร์"],
    language: "th",
  },
  {
    term: "คอยล์ร้อน",
    synonyms: ["คอนเดนเซอร์", "แผงคอนเดนเซอร์", "รังผึ้งแอร์", "แผงแอร์", "condenser"],
    language: "th",
  },
  {
    term: "ไดเออร์",
    synonyms: ["ดรายเออร์", "รีซีฟเวอร์ดรายเออร์", "ตัวดูดความชื้น", "filter-dryer receiver", "dryer"],
    language: "th",
  },
  {
    term: "วาล์วแอร์",
    synonyms: [
      "วาวล์แอร์",
      "บ๊อกวาล์วแอร์",
      "วาล์วตู้แอร์",
      "เอ็กซ์แพนชั่นวาล์ว",
      "เอ็กซ์แพนชันวาล์ว",
      "วาล์วขยาย",
      "expansion valve",
    ],
    language: "th",
  },
  {
    term: "พัดลมแอร์",
    synonyms: ["มอเตอร์พัดลมแอร์", "โบเวอร์", "โบลเวอร์", "พัดลมโบลเวอร์แอร์", "มอเตอร์โบลเวอร์", "blower"],
    language: "th",
  },
  {
    term: "น้ำยาแอร์",
    synonyms: ["สารทำความเย็น", "refrigerant", "r134a", "r-134a"],
    language: "th",
  },
  {
    term: "หม้อน้ำ",
    synonyms: ["หม้อน้ำรถยนต์", "รังผึ้งหม้อน้ำ", "radiator"],
    language: "th",
  },
  {
    term: "ฝาหม้อน้ำ",
    synonyms: ["ฝาหม้อน้ำรถยนต์", "radiator cap"],
    language: "th",
  },
  {
    term: "พัดลมหม้อน้ำ",
    synonyms: ["พัดลมหม้อน้ำรถยนต์", "พัดลมหม้อน้ำไฟฟ้า", "มอเตอร์พัดลมหม้อน้ำ", "มอเตอร์พัดลมระบายความร้อน"],
    language: "th",
  },
  {
    term: "น้ำยาหม้อน้ำ",
    synonyms: ["น้ำยาหล่อเย็น", "น้ำยาหล่อเย็นหม้อน้ำ", "คูลแลนท์", "radiator coolant", "coolant"],
    language: "th",
  },
  {
    term: "ปั๊มน้ำรถยนต์",
    synonyms: ["ปั๊มน้ำ", "ปั้มน้ำ", "ปั้มน้ำรถยนต์", "water pump"],
    language: "th",
  },
  {
    term: "เทอร์โมสตัท",
    synonyms: ["วาล์วน้ำ", "thermostat"],
    language: "th",
  },
];

const normalize = (value: string) => value.trim();

const mergeSynonyms = (existing: string[], incoming: string[], term: string) => {
  const lowerTerm = term.toLowerCase();
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const value of [...existing, ...incoming]) {
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
