import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/**
 * Idempotent seed for the 3 default customer types.
 * - "ลูกค้าทั่วไป" → RETAIL Price List (system, ห้ามลบ)
 * - "สมาชิก" → MEMBER Price List
 * - "อู่ซ่อมรถ" → WHOLESALE Price List
 *
 * เป็น seed แบบ create-only — ไม่แก้ประเภทลูกค้าที่มีอยู่แล้วในระบบ
 *
 * Run once after `prisma db push`:
 *   npx tsx --env-file=.env.local scripts/seed-customer-types.ts
 */
const seeds: Array<{
  name: string;
  priceTier: "RETAIL" | "MEMBER" | "WHOLESALE";
  priceListCode: "RETAIL" | "MEMBER" | "WHOLESALE";
  sortOrder: number;
  isSystem: boolean;
}> = [
  { name: "ลูกค้าทั่วไป", priceTier: "RETAIL", priceListCode: "RETAIL", sortOrder: 0, isSystem: true },
  { name: "สมาชิก", priceTier: "MEMBER", priceListCode: "MEMBER", sortOrder: 1, isSystem: false },
  { name: "อู่ซ่อมรถ", priceTier: "WHOLESALE", priceListCode: "WHOLESALE", sortOrder: 2, isSystem: false },
];

async function main() {
  const { db } = await import("../lib/db");
  try {
    const priceLists = await db.priceList.findMany({
      where: { code: { in: seeds.map((seed) => seed.priceListCode) }, isActive: true },
      select: { id: true, code: true },
    });
    const priceListIdByCode = new Map(priceLists.map((priceList) => [priceList.code, priceList.id]));
    if (priceLists.length !== seeds.length) {
      throw new Error("Default Price Lists are missing. Run the approved Price List migration/backfill first.");
    }
    for (const seed of seeds) {
      const existing = await db.customerType.findUnique({ where: { name: seed.name } });
      if (existing) {
        console.log(`= ข้าม: "${seed.name}" มีอยู่แล้ว`);
        continue;
      }
      const { priceListCode, ...data } = seed;
      await db.customerType.create({
        data: { ...data, priceListId: priceListIdByCode.get(priceListCode)! },
      });
      console.log(`+ สร้าง: "${seed.name}" (Price List=${priceListCode})`);
    }
    console.log("เสร็จสิ้น seed ประเภทลูกค้า");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
