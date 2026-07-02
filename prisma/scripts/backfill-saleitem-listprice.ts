/**
 * Backfill SaleItem.unitListPrice for legacy rows.
 *
 * Before this feature, line-level discounts were baked directly into
 * `salePrice` (net unit price). There was no record of the pre-discount
 * "list" price. For every existing row we therefore treat the current
 * net price as the list price (no discount recorded):
 *
 *   unitListPrice = salePrice   (only when unitListPrice is still 0)
 *   lineDiscount  = 0           (schema default — left untouched)
 *
 * This is purely additive and never changes any monetary total: salePrice,
 * totalAmount, subtotalAmount, cost, VAT and profit are all left as-is.
 *
 * Run with:  npx tsx prisma/scripts/backfill-saleitem-listprice.ts
 */
import { db } from "@/lib/db";

const BATCH_SIZE = 500;

async function main() {
  let updated = 0;
  let cursor: string | null = null;

  // Only rows where unitListPrice is still the schema default (0) but a real
  // salePrice exists get their list price seeded. Rows already carrying a
  // list price (created after this feature) are skipped.
  for (;;) {
    const rows: { id: string; salePrice: unknown }[] = await db.saleItem.findMany({
      where: { unitListPrice: 0 },
      select: { id: true, salePrice: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      await db.saleItem.update({
        where: { id: row.id },
        data: { unitListPrice: row.salePrice as never },
      });
      updated += 1;
    }

    cursor = rows[rows.length - 1].id;
    console.log(`  ...processed ${updated} rows so far`);

    if (rows.length < BATCH_SIZE) break;
  }

  console.log(`Done. Backfilled unitListPrice on ${updated} SaleItem rows.`);
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
