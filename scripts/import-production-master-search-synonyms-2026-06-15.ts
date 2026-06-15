import { db } from "../lib/db";
import { normalizeSearchText } from "../lib/search-normalization";

type SynonymSeed = {
  term: string;
  synonyms: string[];
  language?: string;
  reason: string;
};

const MAX_SYNONYMS_PER_TERM = 10;
const shouldApply = process.argv.includes("--apply");

const seeds: SynonymSeed[] = [
  {
    term: "ท่อยางหม้อน้ำ",
    synonyms: ["ท่อยางน้ำ", "ท่อหม้อน้ำ", "ท่อน้ำหม้อน้ำ", "ท่อยางหม้อน้ำรถยนต์", "radiator hose", "water hose", "coolant hose"],
    language: "mixed",
    reason: "production category gap: Radiator Hose",
  },
  {
    term: "AARON",
    synonyms: ["Aaron", "แอรอน"],
    language: "mixed",
    reason: "production parts brand gap",
  },
  {
    term: "COOL GEAR",
    synonyms: ["Cool Gear", "Coolgear", "คูลเกียร์"],
    language: "mixed",
    reason: "production parts brand gap",
  },
  {
    term: "COTRAN",
    synonyms: ["Cotran", "โคทราน"],
    language: "mixed",
    reason: "production parts brand gap",
  },
  {
    term: "DKR",
    synonyms: ["D K R", "ดีเคอาร์"],
    language: "mixed",
    reason: "production parts brand gap",
  },
  {
    term: "FOMULA",
    synonyms: ["Formula", "ฟอร์มูล่า", "ฟอมูล่า"],
    language: "mixed",
    reason: "production parts brand gap; common English correction",
  },
  {
    term: "Hi-CLEAR by SUN POWER",
    synonyms: ["Hi-CLEAR", "Hi Clear", "HiClear", "SUN POWER", "ไฮเคลียร์", "ซันพาวเวอร์"],
    language: "mixed",
    reason: "production parts brand gap; spacing/no-spacing variants",
  },
  {
    term: "Hi-SPEC",
    synonyms: ["Hi SPEC", "HiSpec", "ไฮสเปค"],
    language: "mixed",
    reason: "production parts brand gap; spacing/no-spacing variants",
  },
  {
    term: "HONGSEN",
    synonyms: ["Hongsen", "ฮงเซน"],
    language: "mixed",
    reason: "production parts brand gap",
  },
  {
    term: "HYTEC",
    synonyms: ["Hytec", "Hi-Tec", "ไฮเทค"],
    language: "mixed",
    reason: "production parts brand gap",
  },
  {
    term: "JT",
    synonyms: ["J T", "เจที"],
    language: "mixed",
    reason: "production parts brand gap",
  },
  {
    term: "NAZA",
    synonyms: ["Naza", "นาซ่า", "นาซา"],
    language: "mixed",
    reason: "production parts brand gap",
  },
  {
    term: "No Brand",
    synonyms: ["NoBrand", "no brand", "โนแบรนด์", "ไม่มียี่ห้อ"],
    language: "mixed",
    reason: "production parts brand gap",
  },
  {
    term: "Orbit",
    synonyms: ["ORBIT", "ออร์บิท"],
    language: "mixed",
    reason: "production parts brand gap",
  },
  {
    term: "PANASONIC",
    synonyms: ["Panasonic", "พานาโซนิค"],
    language: "mixed",
    reason: "production parts brand gap",
  },
  {
    term: "Pokka",
    synonyms: ["POKKA", "ป๊อกก้า", "ป๊อกกา"],
    language: "mixed",
    reason: "production parts brand gap",
  },
  {
    term: "PROTECT",
    synonyms: ["Protect", "โปรเทค"],
    language: "mixed",
    reason: "production parts brand gap",
  },
  {
    term: "SANDEN",
    synonyms: ["Sanden", "แซนเดน", "แซนเด้น"],
    language: "mixed",
    reason: "production parts brand gap; automotive A/C compressor brand",
  },
  {
    term: "SKR",
    synonyms: ["S K R", "เอสเคอาร์"],
    language: "mixed",
    reason: "production parts brand gap",
  },
  {
    term: "STAL",
    synonyms: ["Stal", "สตาล"],
    language: "mixed",
    reason: "production parts brand gap",
  },
  {
    term: "SUNOCO",
    synonyms: ["Sunoco", "ซูโนโก้", "ซูโนโก"],
    language: "mixed",
    reason: "production parts brand gap; oil brand",
  },
  {
    term: "Vinn",
    synonyms: ["VINN", "วินน์", "วิน"],
    language: "mixed",
    reason: "production parts brand gap",
  },
  {
    term: "ตราหมี EMKARATE",
    synonyms: ["EMKARATE", "Emkarate", "ตราหมี", "เอ็มคาเรท", "เอมคาเรท"],
    language: "mixed",
    reason: "production parts brand gap; compressor oil brand spelling",
  },
  {
    term: "เล็กสุพรรณ",
    synonyms: ["เล็ก สุพรรณ", "Lek Suphan", "Leksuphan"],
    language: "mixed",
    reason: "production parts brand gap",
  },
  {
    term: "UD 195",
    synonyms: ["UD195", "ยูดี 195", "ยูดี195"],
    language: "mixed",
    reason: "production car model gap",
  },
  {
    term: "Roewe 350",
    synonyms: ["Roewe350", "โรวี 350", "โรวี่ 350", "โรเว่ 350"],
    language: "mixed",
    reason: "production car model gap",
  },
  {
    term: "AE100-101",
    synonyms: ["AE100", "AE101", "AE 100", "AE 101", "เออี100", "เออี101"],
    language: "mixed",
    reason: "production Toyota model/chassis gap",
  },
  {
    term: "AE110/111",
    synonyms: ["AE110", "AE111", "AE 110", "AE 111", "เออี110", "เออี111"],
    language: "mixed",
    reason: "production Toyota model/chassis gap",
  },
  {
    term: "AT170",
    synonyms: ["AT 170", "เอที170", "Toyota AT170"],
    language: "mixed",
    reason: "production Toyota model/chassis gap",
  },
  {
    term: "AT190",
    synonyms: ["AT 190", "เอที190", "Toyota AT190"],
    language: "mixed",
    reason: "production Toyota model/chassis gap",
  },
  {
    term: "AVEO CNG",
    synonyms: ["Aveo CNG", "AVEO C N G", "อาวีโอซีเอ็นจี", "อาวีโอ CNG"],
    language: "mixed",
    reason: "production car model gap",
  },
  {
    term: "BIG-M",
    synonyms: ["Big-M", "Big M", "BIGM", "บิ๊กเอ็ม", "นิสสันบิ๊กเอ็ม"],
    language: "mixed",
    reason: "production car model gap",
  },
  {
    term: "DRAGON EYE",
    synonyms: ["Dragon Eye", "DragonEye", "ดราก้อนอาย", "ดราก้อนอายส์", "อีซูซุดราก้อนอาย"],
    language: "mixed",
    reason: "production car model gap",
  },
  {
    term: "Estima",
    synonyms: ["เอสติม่า", "เอสติมา", "Toyota Estima", "โตโยต้า Estima"],
    language: "mixed",
    reason: "production car model gap",
  },
  {
    term: "Fighter",
    synonyms: ["ไฟเตอร์", "Mazda Fighter", "มาสด้า Fighter", "มาสด้าไฟเตอร์"],
    language: "mixed",
    reason: "production car model gap",
  },
  {
    term: "Focus",
    synonyms: ["โฟกัส", "Ford Focus", "ฟอร์ด Focus", "ฟอร์ดโฟกัส"],
    language: "mixed",
    reason: "production car model gap",
  },
  {
    term: "FTR",
    synonyms: ["F T R", "เอฟทีอาร์", "Isuzu FTR", "อีซูซุ FTR"],
    language: "mixed",
    reason: "production Isuzu truck model gap",
  },
  {
    term: "FVZ",
    synonyms: ["F V Z", "เอฟวีแซด", "Isuzu FVZ", "อีซูซุ FVZ"],
    language: "mixed",
    reason: "production Isuzu truck model gap",
  },
  {
    term: "G-WAGON",
    synonyms: ["G Wagon", "GWagon", "จีวากอน", "จีวาก้อน", "Mitsubishi G-WAGON"],
    language: "mixed",
    reason: "production car model gap",
  },
  {
    term: "GRANDIS",
    synonyms: ["Grandis", "แกรนดิส", "แกรนดิซ", "Mitsubishi Grandis"],
    language: "mixed",
    reason: "production car model gap",
  },
  {
    term: "Lexus GS",
    synonyms: ["GS300", "จีเอส", "เลกซัส GS"],
    language: "mixed",
    reason: "production Lexus model gap",
  },
  {
    term: "Lexus HS",
    synonyms: ["HS250h", "เอชเอส", "เลกซัส HS"],
    language: "mixed",
    reason: "production Lexus model gap",
  },
  {
    term: "Lexus IS",
    synonyms: ["IS250", "ไอเอส", "เลกซัส IS"],
    language: "mixed",
    reason: "production Lexus model gap",
  },
  {
    term: "Mega 500",
    synonyms: ["Mega500", "เมก้า500", "เมก้า 500", "Hino Mega 500", "ฮีโน่ Mega 500"],
    language: "mixed",
    reason: "production HINO model gap",
  },
  {
    term: "Micra",
    synonyms: ["ไมคร่า", "ไมครา", "Nissan Micra", "นิสสัน Micra"],
    language: "mixed",
    reason: "production car model gap",
  },
  {
    term: "Mobilio",
    synonyms: ["โมบิลิโอ", "โมบิลิโอ้", "Honda Mobilio", "ฮอนด้า Mobilio"],
    language: "mixed",
    reason: "production car model gap",
  },
  {
    term: "NLR",
    synonyms: ["N L R", "เอ็นแอลอาร์", "Isuzu NLR", "อีซูซุ NLR"],
    language: "mixed",
    reason: "production Isuzu truck model gap",
  },
  {
    term: "NMR",
    synonyms: ["N M R", "เอ็นเอ็มอาร์", "Isuzu NMR", "อีซูซุ NMR"],
    language: "mixed",
    reason: "production Isuzu truck model gap",
  },
  {
    term: "NPR",
    synonyms: ["N P R", "เอ็นพีอาร์", "Isuzu NPR", "อีซูซุ NPR"],
    language: "mixed",
    reason: "production Isuzu truck model gap",
  },
  {
    term: "RegiusAce",
    synonyms: ["Regius Ace", "รีจิอัสเอซ", "รีเจียสเอซ", "Toyota RegiusAce"],
    language: "mixed",
    reason: "production Toyota model gap",
  },
  {
    term: "Sentra",
    synonyms: ["เซนทรา", "เซนตร้า", "Nissan Sentra", "นิสสัน Sentra"],
    language: "mixed",
    reason: "production car model gap",
  },
  {
    term: "Sienta",
    synonyms: ["เซียนต้า", "เซียนตา", "Toyota Sienta", "โตโยต้า Sienta"],
    language: "mixed",
    reason: "production car model gap",
  },
  {
    term: "SOLUNA",
    synonyms: ["Soluna", "โซลูน่า", "โซลูนา", "Toyota Soluna"],
    language: "mixed",
    reason: "production car model gap",
  },
  {
    term: "Spacewagon",
    synonyms: ["Space Wagon", "สเปซวากอน", "สเปซแวกอน", "Mitsubishi Spacewagon"],
    language: "mixed",
    reason: "production car model gap",
  },
  {
    term: "Stream",
    synonyms: ["สตรีม", "Honda Stream", "ฮอนด้า Stream"],
    language: "mixed",
    reason: "production car model gap",
  },
  {
    term: "Sunny",
    synonyms: ["ซันนี่", "ซันนี", "Nissan Sunny", "นิสสัน Sunny"],
    language: "mixed",
    reason: "production car model gap",
  },
  {
    term: "TFR",
    synonyms: ["T F R", "ทีเอฟอาร์", "Isuzu TFR", "อีซูซุ TFR"],
    language: "mixed",
    reason: "production Isuzu model gap",
  },
  {
    term: "TROOPER",
    synonyms: ["Trooper", "ทรูเปอร์", "Isuzu Trooper", "อีซูซุ Trooper"],
    language: "mixed",
    reason: "production Isuzu model gap",
  },
  {
    term: "Vellfire",
    synonyms: ["เวลไฟร์", "เวลฟาย", "Toyota Vellfire", "โตโยต้า Vellfire"],
    language: "mixed",
    reason: "production car model gap",
  },
];

const normalize = (value: string) => value.trim();

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

  for (const value of [...incoming, ...existing]) {
    const clean = normalize(value);
    const key = normalizeSearchText(clean);
    if (!clean || key === normalizedTerm || seen.has(key)) continue;
    if (globallyUsed.has(key)) continue;
    seen.add(key);
    merged.push(clean);
  }

  return merged.slice(0, MAX_SYNONYMS_PER_TERM);
};

async function main() {
  const existingRows = await db.searchSynonym.findMany({
    select: { id: true, term: true, synonyms: true, language: true, isActive: true },
  });
  const normalizedTermMap = new Map(existingRows.map((row) => [normalizeSearchText(row.term), row]));
  const globallyUsed = new Set<string>();
  for (const row of existingRows) {
    globallyUsed.add(normalizeSearchText(row.term));
    for (const synonym of row.synonyms) {
      globallyUsed.add(normalizeSearchText(synonym));
    }
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let addedSynonyms = 0;
  const changes: string[] = [];

  for (const seed of seeds) {
    const term = normalize(seed.term);
    const termKey = normalizeSearchText(term);
    const existing = normalizedTermMap.get(termKey);
    const scopedUsed = new Set(globallyUsed);
    if (existing) {
      scopedUsed.delete(normalizeSearchText(existing.term));
      for (const synonym of existing.synonyms) scopedUsed.delete(normalizeSearchText(synonym));
    }
    const synonyms = mergeSynonyms({
      existing: existing?.synonyms ?? [],
      incoming: seed.synonyms,
      term: existing?.term ?? term,
      globallyUsed: scopedUsed,
    });
    const oldSynonyms = existing?.synonyms ?? [];

    if (existing) {
      if (
        existing.isActive &&
        oldSynonyms.length === synonyms.length &&
        oldSynonyms.every((value, index) => value === synonyms[index])
      ) {
        skipped += 1;
        continue;
      }

      updated += 1;
      addedSynonyms += Math.max(0, synonyms.length - oldSynonyms.length);
      changes.push(`update: ${existing.term} -> ${synonyms.join(" | ")} (${seed.reason})`);
      if (shouldApply) {
        await db.searchSynonym.update({
          where: { id: existing.id },
          data: {
            synonyms,
            language: existing.language ?? seed.language ?? null,
            isActive: true,
          },
        });
      }
      continue;
    }

    if (synonyms.length === 0) {
      skipped += 1;
      continue;
    }

    created += 1;
    addedSynonyms += synonyms.length;
    changes.push(`create: ${term} -> ${synonyms.join(" | ")} (${seed.reason})`);
    if (shouldApply) {
      const createdRow = await db.searchSynonym.create({
        data: {
          term,
          synonyms,
          language: seed.language ?? null,
          isActive: true,
        },
      });
      normalizedTermMap.set(termKey, {
        id: createdRow.id,
        term,
        synonyms,
        language: seed.language ?? null,
        isActive: true,
      });
    } else {
      normalizedTermMap.set(termKey, {
        id: "",
        term,
        synonyms,
        language: seed.language ?? null,
        isActive: true,
      });
    }
  }

  console.log(
    `${shouldApply ? "Applied" : "Dry-run"} master search synonyms. seeds=${seeds.length} created=${created} updated=${updated} skipped=${skipped} addedSynonyms=${addedSynonyms}`,
  );
  for (const change of changes) console.log(change);
}

main()
  .catch((error) => {
    console.error("Import failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
