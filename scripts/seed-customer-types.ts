import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/**
 * Idempotent seed for the 3 default customer types.
 * - "ลูกค้าทั่วไป": priceTier=RETAIL (system, ห้ามลบ) — เห็นราคาขายปลีก (Product.retailPrice)
 * - "สมาชิก":      priceTier=MEMBER — เห็นราคาสมาชิก (Product.memberPrice)
 * - "อู่ซ่อมรถ":   priceTier=WHOLESALE — เห็นราคาขายส่ง (Product.salePrice)
 *
 * showPrice = แสดงราคาจริงในแชท LINE/Messenger (false → "สอบถามราคา")
 * เป็น seed แบบ create-only — ไม่แก้ประเภทลูกค้าที่มีอยู่แล้วในระบบ
 *
 * Run once after `prisma db push`:
 *   npx tsx --env-file=.env.local scripts/seed-customer-types.ts
 */
const seeds: Array<{
  name: string;
  priceTier: "RETAIL" | "MEMBER" | "WHOLESALE";
  showPrice: boolean;
  sortOrder: number;
  isSystem: boolean;
}> = [
  { name: "ลูกค้าทั่วไป", priceTier: "RETAIL", showPrice: false, sortOrder: 0, isSystem: true },
  { name: "สมาชิก", priceTier: "MEMBER", showPrice: true, sortOrder: 1, isSystem: false },
  { name: "อู่ซ่อมรถ", priceTier: "WHOLESALE", showPrice: true, sortOrder: 2, isSystem: false },
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
