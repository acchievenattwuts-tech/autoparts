import { db } from "../lib/db";
import { normalizeSearchText } from "../lib/search-normalization";

type SynonymSeed = {
  term: string;
  synonyms: string[];
  language?: string;
};

const MAX_SYNONYMS_PER_TERM = 10;

const seeds: SynonymSeed[] = [
  {
    term: "กรองแอร์",
    synonyms: ["กรองแอร์รถยนต์", "กรองแอ", "กลองแอร์", "cabin air filter", "cabin filter", "air cabin filter"],
    language: "mixed",
  },
  {
    term: "กรองอากาศ",
    synonyms: ["กรองอากาศรถยนต์", "กรองอากาด", "กลองอากาศ", "air filter", "engine air filter"],
    language: "mixed",
  },
  {
    term: "คลัทช์คอมแอร์",
    synonyms: ["คลัชคอมแอร์", "ครัชคอมแอร์", "คลัทคอมแอร์", "หน้าคลัทช์คอมแอร์", "magnetic clutch", "compressor clutch"],
    language: "mixed",
  },
  {
    term: "หน้าครัช",
    synonyms: ["หน้าคลัช", "หน้าคลัทช์", "หน้าครัชคอมแอร์", "หน้าคลัชคอมแอร์", "clutch plate", "clutch hub"],
    language: "mixed",
  },
  {
    term: "น้ำมันคอมแอร์",
    synonyms: ["น้ำมันคอม", "น้ำมันคอมเพรสเซอร์", "น้ำมันคอมเพรสเซอร์แอร์", "compressor oil", "ac compressor oil", "pag oil", "pag46"],
    language: "mixed",
  },
  {
    term: "รีซิสเตอร์พัดลมแอร์",
    synonyms: ["รีซิสเตอร์แอร์", "รีซีสเตอร์แอร์", "ตัวต้านทานพัดลมแอร์", "blower motor resistor", "blower resistor", "resistor blower"],
    language: "mixed",
  },
  {
    term: "สายน้ำยา",
    synonyms: ["สายน้ำยาแอร์", "สายน้ำยาแอร์รถยนต์", "ท่อน้ำยาแอร์", "ท่อแอร์", "a/c hose", "ac hose", "aircon hose"],
    language: "mixed",
  },
  {
    term: "มอเตอร์พัดลมหน้าเครื่อง",
    synonyms: [
      "มอเตอร์พัดลมหน้าแผงแอร์",
      "มอเตอร์หน้าแผงแอร์",
      "พัดลมหน้าแผงแอร์",
      "พัดลมหน้าเครื่อง",
      "condenser fan motor",
      "cooling fan motor",
    ],
    language: "mixed",
  },
  {
    term: "Denso",
    synonyms: ["เด็นโซ่", "เดนโซ่"],
    language: "mixed",
  },
  {
    term: "Valeo",
    synonyms: ["วาลีโอ", "วาเลโอ"],
    language: "mixed",
  },
  {
    term: "Calsonic",
    synonyms: ["คาลโซนิค", "แคลโซนิค"],
    language: "mixed",
  },
  {
    term: "MAGNET MARELLI",
    synonyms: ["Magnet Marelli", "แม็กเนต มาเรลลี่", "แมกเนต มาเรลลี", "มาเรลลี่"],
    language: "mixed",
  },
  {
    term: "HINO",
    synonyms: ["Hino", "ฮีโน่", "ฮีโน"],
    language: "mixed",
  },
  {
    term: "HYUNDAI",
    synonyms: ["Hyundai", "ฮุนได", "ฮุนใด"],
    language: "mixed",
  },
  {
    term: "Lexus",
    synonyms: ["เลกซัส", "เล็กซัส"],
    language: "mixed",
  },
  {
    term: "Roewe",
    synonyms: ["โรเว่", "โรวี", "โรวี่"],
    language: "mixed",
  },
  {
    term: "UD",
    synonyms: ["ยูดี", "ยูดีทรัค", "ud truck"],
    language: "mixed",
  },
  {
    term: "AVEO",
    synonyms: ["Aveo", "อาวีโอ", "อาวีโอ้", "Chevrolet AVEO", "เชฟโรเลต AVEO"],
    language: "mixed",
  },
  {
    term: "Captiva",
    synonyms: ["แคปติว่า", "แคปทิวา", "แคปติวา", "Chevrolet Captiva", "เชฟโรเลต Captiva"],
    language: "mixed",
  },
  {
    term: "Cruze",
    synonyms: ["ครูซ", "ครูส", "Chevrolet Cruze", "เชฟโรเลต Cruze"],
    language: "mixed",
  },
  {
    term: "Optra",
    synonyms: ["ออพตร้า", "ออปตร้า", "ออพตรา", "Chevrolet Optra", "เชฟโรเลต Optra"],
    language: "mixed",
  },
  {
    term: "Sonic",
    synonyms: ["โซนิค", "โซนิก", "Chevrolet Sonic", "เชฟโรเลต Sonic"],
    language: "mixed",
  },
  {
    term: "Spin",
    synonyms: ["สปิน", "Chevrolet Spin", "เชฟโรเลต Spin"],
    language: "mixed",
  },
  {
    term: "Zafira",
    synonyms: ["ซาฟิร่า", "ซาฟิรา", "Chevrolet Zafira", "เชฟโรเลต Zafira"],
    language: "mixed",
  },
  {
    term: "Fiesta",
    synonyms: ["เฟียสต้า", "เฟียสตา", "ฟิเอสต้า", "Ford Fiesta", "ฟอร์ด Fiesta"],
    language: "mixed",
  },
  {
    term: "Mega",
    synonyms: ["เมก้า", "เมกก้า", "Hino Mega", "HINO Mega", "ฮีโน่ Mega"],
    language: "mixed",
  },
  {
    term: "Amaze",
    synonyms: ["อเมซ", "อะเมซ", "Honda Amaze", "ฮอนด้า Amaze"],
    language: "mixed",
  },
  {
    term: "Brio",
    synonyms: ["บริโอ", "บรีโอ", "Honda Brio", "ฮอนด้า Brio"],
    language: "mixed",
  },
  {
    term: "Freed",
    synonyms: ["ฟรีด", "Honda Freed", "ฮอนด้า Freed"],
    language: "mixed",
  },
  {
    term: "H-1",
    synonyms: ["H1", "H 1", "เอชวัน", "เฮชวัน", "Hyundai H-1", "ฮุนได H-1"],
    language: "mixed",
  },
  {
    term: "DECA",
    synonyms: ["Deca", "เดก้า", "เดกก้า", "Isuzu DECA", "อีซูซุ DECA"],
    language: "mixed",
  },
  {
    term: "MU-7",
    synonyms: ["MU7", "MU 7", "มิวเซเว่น", "มิว 7", "Isuzu MU-7", "อีซูซุ MU-7"],
    language: "mixed",
  },
  {
    term: "RX",
    synonyms: ["อาร์เอ็กซ์", "อาเอ็กซ์", "Lexus RX", "เลกซัส RX"],
    language: "mixed",
  },
  {
    term: "BT-50 Pro",
    synonyms: ["BT50 Pro", "BT 50 Pro", "บีที50โปร", "บีทีโปร", "Mazda BT-50 Pro", "มาสด้า BT-50 Pro"],
    language: "mixed",
  },
  {
    term: "Mazda 5",
    synonyms: ["Mazda5", "มาสด้า5", "มาสด้า 5", "มาสด้าห้า"],
    language: "mixed",
  },
  {
    term: "Mazda 6",
    synonyms: ["Mazda6", "มาสด้า6", "มาสด้า 6", "มาสด้าหก"],
    language: "mixed",
  },
  {
    term: "MG GT",
    synonyms: ["MGGT", "เอ็มจีจีที", "เอ็มจี GT", "เอมจี GT"],
    language: "mixed",
  },
  {
    term: "Lancer",
    synonyms: ["แลนเซอร์", "แลนเซอ", "Mitsubishi Lancer", "มิตซูบิชิ Lancer"],
    language: "mixed",
  },
  {
    term: "Mirage",
    synonyms: ["มิราจ", "มิราจน์", "Mitsubishi Mirage", "มิตซูบิชิ Mirage"],
    language: "mixed",
  },
  {
    term: "Pajero",
    synonyms: ["ปาเจโร่", "ปาเจโร", "Mitsubishi Pajero", "มิตซูบิชิ Pajero"],
    language: "mixed",
  },
  {
    term: "Strada",
    synonyms: ["สตราด้า", "สตราดา", "Mitsubishi Strada", "มิตซูบิชิ Strada"],
    language: "mixed",
  },
  {
    term: "Cube",
    synonyms: ["คิวบ์", "คิวบ", "Nissan Cube", "นิสสัน Cube"],
    language: "mixed",
  },
  {
    term: "Frontier",
    synonyms: ["ฟรอนเทียร์", "ฟรอนเทีย", "Nissan Frontier", "นิสสัน Frontier"],
    language: "mixed",
  },
  {
    term: "Juke",
    synonyms: ["จู๊ค", "จูค", "Nissan Juke", "นิสสัน Juke"],
    language: "mixed",
  },
  {
    term: "Leaf",
    synonyms: ["ลีฟ", "ลิฟ", "Nissan Leaf", "นิสสัน Leaf"],
    language: "mixed",
  },
  {
    term: "NP300",
    synonyms: ["NP 300", "เอ็นพี300", "เอ็นพี 300", "Nissan NP300", "นิสสัน NP300"],
    language: "mixed",
  },
  {
    term: "Pulsar",
    synonyms: ["พัลซาร์", "พัลซา", "Nissan Pulsar", "นิสสัน Pulsar"],
    language: "mixed",
  },
  {
    term: "Sylphy",
    synonyms: ["ซิลฟี่", "ซิลฟี", "ซิลฟี่นิสสัน", "Nissan Sylphy", "นิสสัน Sylphy"],
    language: "mixed",
  },
  {
    term: "Teana",
    synonyms: ["เทียน่า", "เทียนา", "Nissan Teana", "นิสสัน Teana"],
    language: "mixed",
  },
  {
    term: "Tiida",
    synonyms: ["ทีด้า", "ทีดา", "Nissan Tiida", "นิสสัน Tiida"],
    language: "mixed",
  },
  {
    term: "Urvan",
    synonyms: ["เออร์แวน", "เออแวน", "Nissan Urvan", "นิสสัน Urvan"],
    language: "mixed",
  },
  {
    term: "APV",
    synonyms: ["เอพีวี", "เอพี-วี", "Suzuki APV", "ซูซูกิ APV"],
    language: "mixed",
  },
  {
    term: "Celerio",
    synonyms: ["เซเลริโอ", "เซเลรีโอ", "Suzuki Celerio", "ซูซูกิ Celerio"],
    language: "mixed",
  },
  {
    term: "Alphard",
    synonyms: ["อัลพาร์ด", "อัลฟาร์ด", "Toyota Alphard", "โตโยต้า Alphard"],
    language: "mixed",
  },
  {
    term: "Altis",
    synonyms: ["อัลติส", "อัลตีส", "Toyota Altis", "โตโยต้า Altis"],
    language: "mixed",
  },
  {
    term: "Altis Limo",
    synonyms: ["Limo", "ลิโม่", "ลิโม", "อัลติสลิโม่", "Toyota Altis Limo"],
    language: "mixed",
  },
  {
    term: "Avanza",
    synonyms: ["อแวนซ่า", "อแวนซา", "Toyota Avanza", "โตโยต้า Avanza"],
    language: "mixed",
  },
  {
    term: "Corolla Cross",
    synonyms: ["Cross", "โคโรลล่าครอส", "โคโรลลาครอส", "คอโรลล่าครอส", "Toyota Corolla Cross"],
    language: "mixed",
  },
  {
    term: "Hiace",
    synonyms: ["ไฮเอซ", "ไฮเอช", "Toyota Hiace", "โตโยต้า Hiace"],
    language: "mixed",
  },
  {
    term: "Hiace Commuter",
    synonyms: ["Commuter", "คอมมิวเตอร์", "คอมมูเตอร์", "ไฮเอซคอมมิวเตอร์", "Toyota Commuter"],
    language: "mixed",
  },
  {
    term: "Hilux Mighty-X",
    synonyms: ["Mighty-X", "Mighty X", "ไมตี้เอ็กซ์", "ไมตี้เอ็ก", "ไมตี้", "Toyota Mighty-X"],
    language: "mixed",
  },
  {
    term: "Hilux Vigo",
    synonyms: ["Vigo", "วีโก้", "วีโก", "ไฮลักซ์วีโก้", "Toyota Vigo"],
    language: "mixed",
  },
  {
    term: "Innova",
    synonyms: ["อินโนว่า", "อินโนวา", "Toyota Innova", "โตโยต้า Innova"],
    language: "mixed",
  },
  {
    term: "Prius",
    synonyms: ["พรีอุส", "พรีอัส", "Toyota Prius", "โตโยต้า Prius"],
    language: "mixed",
  },
  {
    term: "Tiger",
    synonyms: ["ไทเกอร์", "ไทเกอ", "Toyota Tiger", "โตโยต้า Tiger"],
    language: "mixed",
  },
  {
    term: "Wish",
    synonyms: ["วิช", "Toyota Wish", "โตโยต้า Wish"],
    language: "mixed",
  },
];

const normalize = (value: string) => value.trim();

const mergeSynonyms = (existing: string[], incoming: string[], term: string) => {
  const lowerTerm = normalizeSearchText(term);
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const value of [...incoming, ...existing]) {
    const clean = normalize(value);
    const key = normalizeSearchText(clean);
    if (!clean || key === lowerTerm || seen.has(key)) continue;
    seen.add(key);
    merged.push(clean);
  }

  return merged.slice(0, MAX_SYNONYMS_PER_TERM);
};

async function main() {
  const existingRows = await db.searchSynonym.findMany({
    select: { id: true, term: true, synonyms: true, language: true },
  });
  const normalizedTermMap = new Map(existingRows.map((row) => [normalizeSearchText(row.term), row]));

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let addedSynonyms = 0;

  for (const seed of seeds) {
    const term = normalize(seed.term);
    const existing = normalizedTermMap.get(normalizeSearchText(term));
    const synonyms = mergeSynonyms(existing?.synonyms ?? [], seed.synonyms, existing?.term ?? term);
    const oldCount = existing?.synonyms.length ?? 0;

    if (existing) {
      if (
        existing.synonyms.length === synonyms.length &&
        existing.synonyms.every((value, index) => value === synonyms[index])
      ) {
        skipped += 1;
        continue;
      }

      await db.searchSynonym.update({
        where: { id: existing.id },
        data: {
          synonyms,
          language: existing.language ?? seed.language ?? null,
          isActive: true,
        },
      });
      updated += 1;
      addedSynonyms += Math.max(0, synonyms.length - oldCount);
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
    normalizedTermMap.set(normalizeSearchText(term), {
      id: "",
      term,
      synonyms,
      language: seed.language ?? null,
    });
    created += 1;
    addedSynonyms += synonyms.length;
  }

  console.log(
    `Imported production search synonym gaps. seeds=${seeds.length} created=${created} updated=${updated} skipped=${skipped} addedSynonyms=${addedSynonyms}`,
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
