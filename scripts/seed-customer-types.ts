import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/**
 * Idempotent seed for the 2 default customer types.
 * - "ลูกค้าทั่วไป": priceTier=RETAIL (system, ห้ามลบ) — เห็นราคาขายปลีก (Product.retailPrice)
 * - "อู่ซ่อมรถ":   priceTier=WHOLESALE — เห็นราคาขายส่ง (Product.salePrice)
 *
 * Run once after `prisma db push`:
 *   npx tsx --env-file=.env.local scripts/seed-customer-types.ts
 */
const seeds: Array<{
  name: string;
  priceTier: "RETAIL" | "WHOLESALE";
  sortOrder: number;
  isSystem: boolean;
}> = [
  { name: "ลูกค้าทั่วไป", priceTier: "RETAIL", sortOrder: 0, isSystem: true },
  { name: "อู่ซ่อมรถ", priceTier: "WHOLESALE", sortOrder: 1, isSystem: false },
];

async function main() {
  const { db } = await import("../lib/db");
  try {
    for (const seed of seeds) {
      const existing = await db.customerType.findUnique({ where: { name: seed.name } });
      if (existing) {
        console.log(`= ข้าม: "${seed.name}" มีอยู่แล้ว`);
        continue;
      }
      await db.customerType.create({ data: seed });
      console.log(`+ สร้าง: "${seed.name}" (priceTier=${seed.priceTier})`);
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
