/**
 * Backfill Product.retailPrice (ราคาขายปลีก / ลูกค้าทั่วไป) from salePrice.
 *
 * Pricing rules (confirmed 2026-07-09):
 *   +20% : คอมแอร์ (Compressor)
 *   +30% : คอยล์เย็น (Evaporator), หม้อน้ำ (Radiator),
 *          โบเวอร์ พัดลมแอร์ (Blower Motor),
 *          มอเตอร์พัดลมหน้าเครื่อง / หน้าแผงแอร์ (Condenser Fan Motor),
 *          คอยล์ร้อน (Condenser)  ← "แผงแอร์"
 *   ที่เหลือ : retailPrice = salePrice (คัดลอกตรง ไม่บวก % ไม่ปัดเศษ)
 *
 * Marked-up prices are rounded UP to the nearest 50 (e.g. 170 → 200, 205 → 250).
 * Only main categories match — sub-categories that merely contain the same word
 * (คลัทช์คอมแอร์, ท่อยางหม้อน้ำ, ฯลฯ) fall into "ที่เหลือ".
 *
 * salePrice = 0 → retailPrice = 0 (the sale form falls back to salePrice anyway).
 *
 * Dry-run (default):  npx tsx --env-file=.env.local prisma/scripts/backfill-retail-price.ts
 * Apply:              npx tsx --env-file=.env.local prisma/scripts/backfill-retail-price.ts --apply
 */
import { db } from "../../lib/db";
import { Prisma } from "../../lib/generated/prisma";

const MARKUP_20_NAMES = ["คอมแอร์ (Compressor)"];
const MARKUP_30_NAMES = [
  "คอยล์เย็น (Evaporator)",
  "หม้อน้ำ (Radiator)",
  "โบเวอร์ พัดลมแอร์ (Blower Motor)",
  "มอเตอร์พัดลมหน้าเครื่อง / หน้าแผงแอร์ (Condenser Fan Motor)",
  "คอยล์ร้อน (Condenser)",
];

const ROUND_UP_STEP = 50;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Round a marked-up price UP to the nearest multiple of 50. */
const ceilToStep = (n: number) => (n <= 0 ? 0 : Math.ceil(round2(n) / ROUND_UP_STEP) * ROUND_UP_STEP);

async function resolveCategoryIds(names: string[]): Promise<Map<string, string>> {
  const rows = await db.category.findMany({
    where: { name: { in: names } },
    select: { id: true, name: true },
  });
  const found = new Map(rows.map((r) => [r.name, r.id]));
  const missing = names.filter((name) => !found.has(name));
  if (missing.length > 0) {
    throw new Error(`ไม่พบหมวดหมู่ต่อไปนี้ในระบบ (ตรวจการสะกด): ${missing.join(" | ")}`);
  }
  return found;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const map20 = await resolveCategoryIds(MARKUP_20_NAMES);
  const map30 = await resolveCategoryIds(MARKUP_30_NAMES);
  const ids20 = [...map20.values()];
  const ids30 = [...map30.values()];
  const markedUpIds = [...ids20, ...ids30];

  const products = await db.product.findMany({
    select: { id: true, code: true, categoryId: true, salePrice: true },
  });

  type Group = "+20%" | "+30%" | "salePrice";
  const groupOf = (categoryId: string): Group =>
    ids20.includes(categoryId) ? "+20%" : ids30.includes(categoryId) ? "+30%" : "salePrice";

  const computeRetail = (group: Group, salePrice: number): number => {
    if (group === "+20%") return ceilToStep(salePrice * 1.2);
    if (group === "+30%") return ceilToStep(salePrice * 1.3);
    return round2(salePrice);
  };

  const counts: Record<Group, number> = { "+20%": 0, "+30%": 0, salePrice: 0 };
  const samples: Record<Group, string[]> = { "+20%": [], "+30%": [], salePrice: [] };
  for (const p of products) {
    const group = groupOf(p.categoryId);
    const sale = Number(p.salePrice);
    const retail = computeRetail(group, sale);
    counts[group] += 1;
    if (samples[group].length < 6) {
      samples[group].push(`  ${p.code.padEnd(16)} salePrice ${sale.toFixed(2).padStart(10)} → retailPrice ${retail.toFixed(2).padStart(10)}`);
    }
  }

  console.log("=".repeat(70));
  console.log(apply ? "APPLY MODE — จะเขียนลง DB จริง" : "DRY RUN — ยังไม่เขียน DB (ใส่ --apply เพื่อรันจริง)");
  console.log("=".repeat(70));
  for (const group of ["+20%", "+30%", "salePrice"] as Group[]) {
    console.log(`\n[${group}]  ${counts[group]} รายการ`);
    console.log(samples[group].join("\n"));
  }
  console.log(`\nรวมทั้งหมด: ${products.length} รายการ`);

  if (!apply) {
    console.log("\n(dry-run เท่านั้น — ยังไม่มีการเปลี่ยนแปลง)");
    await db.$disconnect();
    return;
  }

  // Bulk update in a single transaction. Rounding is done in SQL with the same
  // ROUND(,2) → CEIL(/50)*50 formula used for the preview above so the applied
  // values match exactly.
  const step = ROUND_UP_STEP;
  const result = await db.$transaction(
    [
      db.$executeRaw`
      UPDATE "Product"
      SET "retailPrice" = CEIL(ROUND("salePrice" * 1.20, 2) / ${step}::numeric) * ${step}
      WHERE "categoryId" IN (${Prisma.join(ids20)}) AND "salePrice" > 0`,
      db.$executeRaw`
      UPDATE "Product"
      SET "retailPrice" = CEIL(ROUND("salePrice" * 1.30, 2) / ${step}::numeric) * ${step}
      WHERE "categoryId" IN (${Prisma.join(ids30)}) AND "salePrice" > 0`,
      db.$executeRaw`
      UPDATE "Product"
      SET "retailPrice" = "salePrice"
      WHERE "categoryId" NOT IN (${Prisma.join(markedUpIds)})`,
      // marked-up categories with salePrice <= 0 → retailPrice 0 (explicit)
      db.$executeRaw`
      UPDATE "Product"
      SET "retailPrice" = 0
      WHERE "categoryId" IN (${Prisma.join(markedUpIds)}) AND "salePrice" <= 0`,
    ],
  );
  console.log(`\nอัปเดตแล้ว: +20% ${result[0]} แถว, +30% ${result[1]} แถว, ที่เหลือ ${result[2]} แถว, markup-แต่ salePrice0 ${result[3]} แถว`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
