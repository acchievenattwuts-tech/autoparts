/**
 * One-off backfill: set Warranty.createdVia for historical rows.
 *
 * Rules:
 *   - saleId IS NULL                                          → MANUAL (NO_SALE rows just added)
 *   - createdAt > sale.createdAt + 1 minute                   → MANUAL (legacy +บันทึกประกันใหม่ creates)
 *   - everything else                                          → AUTO_FROM_SALE (kept as default)
 *
 * Safe to re-run: only updates rows currently marked AUTO_FROM_SALE.
 */
import { db } from "../../lib/db";

async function main() {
  const noSaleResult = await db.$executeRawUnsafe(`
    UPDATE "Warranty"
    SET "createdVia" = 'MANUAL'
    WHERE "saleId" IS NULL
      AND "createdVia" = 'AUTO_FROM_SALE'
  `);
  console.log(`[backfill] NO_SALE rows marked MANUAL: ${noSaleResult}`);

  const lateCreatedResult = await db.$executeRawUnsafe(`
    UPDATE "Warranty" AS w
    SET "createdVia" = 'MANUAL'
    FROM "Sale" AS s
    WHERE w."saleId" = s."id"
      AND w."createdVia" = 'AUTO_FROM_SALE'
      AND w."createdAt" > s."createdAt" + INTERVAL '1 minute'
  `);
  console.log(`[backfill] Late-created WITH_SALE rows marked MANUAL: ${lateCreatedResult}`);

  const summary = await db.warranty.groupBy({
    by: ["createdVia"],
    _count: { _all: true },
  });
  console.log("[backfill] Final distribution:");
  for (const row of summary) {
    console.log(`  ${row.createdVia}: ${row._count._all}`);
  }
}

main()
  .catch((err) => {
    console.error("[backfill] FAILED", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
