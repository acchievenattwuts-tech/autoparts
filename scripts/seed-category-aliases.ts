import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

type AliasKind = "MATCH" | "SKIP_CATEGORY";
type MatchMode = "EXACT" | "CONTAINS" | "TOKEN";

type SeedAlias = {
  alias: string;
  kind?: AliasKind;
  matchMode?: MatchMode;
  priority?: number;
  notes?: string;
};

type CategoryAliasSeed = {
  categoryIncludes: string;
  aliases: SeedAlias[];
};

const categoryAliasSeeds: CategoryAliasSeed[] = [
  {
    categoryIncludes: "Compressor Control Valve",
    aliases: [
      { alias: "คอนโทรลวาล์ว", priority: 300 },
      { alias: "วาล์วหางคอม", priority: 305 },
      { alias: "หัววาล์วคอม", priority: 305 },
      { alias: "วาล์วท้ายคอม", priority: 305 },
      { alias: "control valve", priority: 300 },
      { alias: "control valve compressor", priority: 305 },
      { alias: "compressor control valve", priority: 320 },
    ],
  },
  {
    categoryIncludes: "Expansion Valve",
    aliases: [
      { alias: "วาล์วแอร์", priority: 280 },
      { alias: "วาวแอร์", priority: 280 },
      { alias: "วาวล์แอร์", priority: 280 },
      { alias: "วาล์วตู้", priority: 270 },
      { alias: "เอ็กแพนชั่นวาล์ว", priority: 280 },
      { alias: "แอกแปนชั่นวาล์ว", priority: 280 },
      { alias: "expansion valve", priority: 280 },
      { alias: "exp valve", priority: 275 },
      { alias: "ex valve", priority: 275 },
      { alias: "บล็อควาล์ว", priority: 270 },
      { alias: "บล็อกวาล์ว", priority: 270 },
      { alias: "วาล์ว", priority: 120, matchMode: "TOKEN" },
    ],
  },
  {
    categoryIncludes: "Compressor Oil",
    aliases: [
      { alias: "น้ำมันคอม", priority: 260 },
      { alias: "compressor oil", priority: 260 },
    ],
  },
  {
    categoryIncludes: "Compressor Clutch",
    aliases: [
      { alias: "หน้าครัช", priority: 250 },
      { alias: "ชุดหน้าครัช", priority: 252 },
      { alias: "หน้าคลัทช์", priority: 250 },
      { alias: "หน้าคลัชคอม", priority: 252 },
      { alias: "คลัทช์คอม", priority: 245 },
      { alias: "มูเล่คอม", priority: 245 },
      { alias: "พูลเล่ย์คอม", priority: 245 },
      { alias: "ลูกรอกคอม", priority: 245 },
      { alias: "magnetic clutch", priority: 240 },
      { alias: "clutch", priority: 220, matchMode: "TOKEN" },
    ],
  },
  {
    categoryIncludes: "(Compressor)",
    aliases: [
      { alias: "คอมแอร์", priority: 200 },
      { alias: "คอมเพรสเซอร์", priority: 200 },
      { alias: "compressor", priority: 100, matchMode: "TOKEN" },
    ],
  },
  {
    categoryIncludes: "Evaporator",
    aliases: [
      { alias: "คอยล์เย็น", priority: 240 },
      { alias: "คอยเย็น", priority: 240 },
      { alias: "คอยล์ตู้", priority: 240 },
      { alias: "คอยตู้", priority: 235 },
      { alias: "ตู้แอร์", priority: 240 },
      { alias: "แผงตู้แอร์", priority: 235 },
      { alias: "ตู้เย็น", priority: 220 },
      { alias: "อีวา", priority: 230 },
      { alias: "อีแวป", priority: 230 },
      { alias: "evaporator", priority: 240 },
      { alias: "evap", priority: 230 },
      { alias: "evap core", priority: 230 },
    ],
  },
  {
    categoryIncludes: "Condenser)",
    aliases: [
      { alias: "คอยล์ร้อน", priority: 240 },
      { alias: "คอยร้อน", priority: 240 },
      { alias: "แผงแอร์", priority: 240 },
      { alias: "แผงคอยล์ร้อน", priority: 240 },
      { alias: "แผงหน้าแอร์", priority: 235 },
      { alias: "หม้อน้ำแอร์", priority: 235 },
      { alias: "คอนเดนเซอร์แอร์", priority: 235 },
      { alias: "แผงร้อน", priority: 230 },
      { alias: "รังผึ้งแอร์", priority: 230 },
      { alias: "condenser", priority: 240 },
      { alias: "condensor", priority: 230 },
    ],
  },
  {
    categoryIncludes: "Cabin air filter",
    aliases: [
      { alias: "กรองแอร์", priority: 230 },
      { alias: "ฟิลเตอร์แอร์", priority: 220 },
      { alias: "cabin", priority: 180, matchMode: "TOKEN" },
      { alias: "cabin filter", priority: 220 },
      // Compound must outrank the nested engine-filter alias "air filter".
      { alias: "cabin air filter", priority: 240 },
    ],
  },
  {
    categoryIncludes: "(Air Filter)",
    aliases: [
      { alias: "กรองอากาศ", priority: 230 },
      { alias: "ไส้กรองอากาศ", priority: 230 },
      { alias: "air filter", priority: 230 },
    ],
  },
  {
    categoryIncludes: "Drier",
    aliases: [
      { alias: "ดรายเออร์", priority: 220 },
      { alias: "ดรายเออร์แอร์", priority: 225 },
      { alias: "ไดเออร์", priority: 220 },
      { alias: "ไดรเออร์", priority: 220 },
      { alias: "ไดเออร์แอร์", priority: 225 },
      { alias: "กรองไดเออร์", priority: 225 },
      { alias: "กระป๋องไดเออร์", priority: 225 },
      { alias: "drier", priority: 220 },
      { alias: "receiver", priority: 200 },
      { alias: "receiver drier", priority: 220 },
      { alias: "receiver dryer", priority: 220 },
    ],
  },
  {
    categoryIncludes: "Blower Motor Resistor",
    aliases: [
      { alias: "รีซิสเตอร์", priority: 260 },
      { alias: "resistor", priority: 240 },
      { alias: "blower resistor", priority: 260 },
    ],
  },
  {
    categoryIncludes: "Blower Motor",
    aliases: [
      { alias: "โบเวอร์", priority: 240 },
      { alias: "พัดลมแอร์", priority: 220 },
      { alias: "มอเตอร์ตู้แอร์", priority: 220 },
      { alias: "มอเตอร์ตู้", priority: 220 },
      { alias: "พัดลมตู้แอร์", priority: 220 },
      { alias: "พัดลมตู้", priority: 220 },
      { alias: "พัดลมโบ", priority: 220 },
      { alias: "โบลเวอร์มอเตอร์", priority: 230 },
      { alias: "blower motor", priority: 230 },
      // Common customer typo; keep exact/curated instead of broad fuzzy matching.
      { alias: "blower moter", priority: 240 },
      { alias: "blower", priority: 200, matchMode: "TOKEN" },
    ],
  },
  {
    categoryIncludes: "Condenser Fan Motor",
    aliases: [
      { alias: "มอเตอร์พัดลม", priority: 210 },
      { alias: "พัดลมหน้าแผง", priority: 220 },
      { alias: "มอเตอร์พัดลมหน้าแผง", priority: 225 },
      { alias: "พัดลมหม้อน้ำ", priority: 220 },
      { alias: "พัดลมหน้าเครื่อง", priority: 220 },
      { alias: "พัดลมคอยล์ร้อน", priority: 225 },
      { alias: "พัดลมคอนเดนเซอร์", priority: 225 },
      { alias: "condenser fan", priority: 220 },
      { alias: "condenser fan motor", priority: 225 },
      // Covers "condensor fan moter" while the longer compound suppresses
      // the nested generic "condensor" → Condenser alias.
      { alias: "condensor fan", priority: 240 },
    ],
  },
  {
    categoryIncludes: "Cooling Fan Blade",
    aliases: [
      { alias: "ใบพัดลม", priority: 230 },
      { alias: "ใบพัด", priority: 180 },
      { alias: "fan blade", priority: 230 },
    ],
  },
  {
    categoryIncludes: "Radiator Cap",
    aliases: [
      { alias: "ฝาหม้อน้ำ", priority: 260 },
      { alias: "ฝาปิดหม้อน้ำ", priority: 260 },
      { alias: "radiator cap", priority: 260 },
    ],
  },
  {
    categoryIncludes: "Radiator Coolant",
    aliases: [
      { alias: "น้ำยาหล่อเย็น", priority: 250 },
      { alias: "คูลแลนท์", priority: 250 },
      { alias: "coolant", priority: 230 },
    ],
  },
  {
    categoryIncludes: "A/C Hose",
    aliases: [
      { alias: "สายน้ำยา", priority: 240 },
      { alias: "สายแอร์", priority: 240 },
      { alias: "ท่อน้ำยา", priority: 240 },
      { alias: "ท่อแอร์", priority: 240 },
      { alias: "ท่อแอร์รถยนต์", priority: 240 },
      { alias: "ท่ออลูมิเนียมแอร์", priority: 240 },
      { alias: "a/c hose", priority: 240 },
      { alias: "ac hose", priority: 230 },
      { alias: "a/c pipe", priority: 230 },
      { alias: "ac pipe", priority: 230 },
    ],
  },
  {
    categoryIncludes: "Radiator Hose",
    aliases: [
      { alias: "ท่อยางหม้อน้ำ", priority: 280 },
      { alias: "ท่อน้ำหม้อน้ำ", priority: 270 },
      { alias: "radiator hose", priority: 280 },
    ],
  },
  {
    categoryIncludes: "(Radiator)",
    aliases: [
      { alias: "หม้อน้ำ", priority: 120 },
      { alias: "หม้อน้ำเครื่อง", priority: 130 },
      { alias: "รังผึ้งน้ำ", priority: 130 },
      { alias: "แผงหม้อน้ำ", priority: 130 },
      { alias: "radiator", priority: 100, matchMode: "TOKEN" },
      { alias: "radiator assy", priority: 120 },
    ],
  },
  {
    categoryIncludes: "อะไหล่อื่น",
    aliases: [
      { alias: "อะไหล่อื่น", priority: 80 },
      { alias: "อื่นๆ", priority: 60 },
      { alias: "น้ำยาล้าง", kind: "SKIP_CATEGORY", priority: 300 },
      { alias: "น้ำยาไล่", kind: "SKIP_CATEGORY", priority: 280 },
      { alias: "ล้างคอย", kind: "SKIP_CATEGORY", priority: 280 },
      { alias: "ล้างแผง", kind: "SKIP_CATEGORY", priority: 280 },
      { alias: "ล้างระบบแอร์", kind: "SKIP_CATEGORY", priority: 280 },
      { alias: "coil cleaner", kind: "SKIP_CATEGORY", priority: 280 },
      { alias: "condenser cleaner", kind: "SKIP_CATEGORY", priority: 280 },
      { alias: "ฟองน้ำ", kind: "SKIP_CATEGORY", priority: 220 },
      { alias: "เทป", kind: "SKIP_CATEGORY", priority: 180, matchMode: "TOKEN" },
      { alias: "น็อต", kind: "SKIP_CATEGORY", priority: 200 },
      { alias: "น๊อต", kind: "SKIP_CATEGORY", priority: 200 },
      { alias: "โอริง", kind: "SKIP_CATEGORY", priority: 220 },
      { alias: "o-ring", kind: "SKIP_CATEGORY", priority: 220 },
      { alias: "oring", kind: "SKIP_CATEGORY", priority: 220 },
      { alias: "ฝาปิดกล่องกรอง", kind: "SKIP_CATEGORY", priority: 260 },
      { alias: "ฝาปิดวาล์ว", kind: "SKIP_CATEGORY", priority: 260 },
      { alias: "เครื่องมือ", kind: "SKIP_CATEGORY", priority: 180 },
      { alias: "ตัวถอด", kind: "SKIP_CATEGORY", priority: 180 },
      { alias: "วาล์วลูกศร", kind: "SKIP_CATEGORY", priority: 240 },
      { alias: "ไส้ศร", kind: "SKIP_CATEGORY", priority: 240 },
      { alias: "หัวคอปเปอร์", kind: "SKIP_CATEGORY", priority: 180 },
      { alias: "หัวเติม", kind: "SKIP_CATEGORY", priority: 180 },
    ],
  },
];

const main = async () => {
  const { db } = await import("../lib/db");
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const seed of categoryAliasSeeds) {
    const category = await db.category.findFirst({
      where: {
        isActive: true,
        name: { contains: seed.categoryIncludes, mode: "insensitive" },
      },
      select: { id: true, name: true },
    });

    if (!category) {
      skipped += seed.aliases.length;
      console.warn(`Skip aliases for missing category: ${seed.categoryIncludes}`);
      continue;
    }

    for (const aliasSeed of seed.aliases) {
      const kind = aliasSeed.kind ?? "MATCH";
      const before = await db.categoryAlias.findUnique({
        where: { alias_kind: { alias: aliasSeed.alias, kind } },
        select: { id: true },
      });

      await db.categoryAlias.upsert({
        where: { alias_kind: { alias: aliasSeed.alias, kind } },
        create: {
          categoryId: category.id,
          alias: aliasSeed.alias,
          kind,
          matchMode: aliasSeed.matchMode ?? "CONTAINS",
          priority: aliasSeed.priority ?? 0,
          notes: aliasSeed.notes ?? "Seeded from legacy LINE fitment category resolver.",
        },
        update: {
          categoryId: category.id,
          matchMode: aliasSeed.matchMode ?? "CONTAINS",
          priority: aliasSeed.priority ?? 0,
          isActive: true,
          notes: aliasSeed.notes ?? "Seeded from legacy LINE fitment category resolver.",
        },
      });

      if (before) updated += 1;
      else created += 1;
    }
  }

  console.log(JSON.stringify({ created, updated, skipped }, null, 2));
  await db.$disconnect();
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
