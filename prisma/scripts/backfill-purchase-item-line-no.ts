/**
 * backfill-purchase-item-line-no.ts
 *
 * One-time migration helper: populate PurchaseItem.lineNo from the creation
 * order of the purchase's StockCard rows. This preserves the line order users
 * saw when stock cards were originally written.
 *
 * Usage:
 *   npx tsx --env-file=.env.local prisma/scripts/backfill-purchase-item-line-no.ts --dry-run
 *   npx tsx --env-file=.env.local prisma/scripts/backfill-purchase-item-line-no.ts
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../lib/generated/prisma";

const DRY_RUN = process.argv.includes("--dry-run");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = new PrismaClient({ adapter });

type PreviewRow = {
  purchaseNo: string;
  currentMinLineNo: number;
  currentMaxLineNo: number;
  itemCount: number;
  stockMatchedCount: number;
};

async function main() {
  console.log(DRY_RUN ? "DRY RUN - no changes will be written\n" : "WRITE mode - PurchaseItem.lineNo will be updated\n");

  const preview = await db.$queryRaw<PreviewRow[]>`
    WITH item_stock AS (
      SELECT
        pi."id",
        pi."purchaseId",
        p."purchaseNo",
        pi."lineNo",
        MIN(sc."createdAt") AS "stockCreatedAt"
      FROM "PurchaseItem" pi
      JOIN "Purchase" p ON p."id" = pi."purchaseId"
      LEFT JOIN "StockCard" sc
        ON sc."docNo" = p."purchaseNo"
       AND sc."referenceId" = pi."id"
      GROUP BY pi."id", pi."purchaseId", p."purchaseNo", pi."lineNo"
    )
    SELECT
      "purchaseNo",
      MIN("lineNo")::int AS "currentMinLineNo",
      MAX("lineNo")::int AS "currentMaxLineNo",
      COUNT(*)::int AS "itemCount",
      COUNT("stockCreatedAt")::int AS "stockMatchedCount"
    FROM item_stock
    GROUP BY "purchaseNo"
    ORDER BY "purchaseNo" DESC
    LIMIT 20
  `;

  console.table(preview);

  if (DRY_RUN) {
    await db.$disconnect();
    return;
  }

  const result = await db.$executeRaw`
    WITH ranked AS (
      SELECT
        pi."id",
        ROW_NUMBER() OVER (
          PARTITION BY pi."purchaseId"
          ORDER BY
            CASE WHEN MIN(sc."createdAt") IS NULL THEN 1 ELSE 0 END,
            MIN(sc."createdAt") ASC,
            MIN(sc."id") ASC,
            pi."id" ASC
        )::int AS "lineNo"
      FROM "PurchaseItem" pi
      JOIN "Purchase" p ON p."id" = pi."purchaseId"
      LEFT JOIN "StockCard" sc
        ON sc."docNo" = p."purchaseNo"
       AND sc."referenceId" = pi."id"
      GROUP BY pi."id", pi."purchaseId"
    )
    UPDATE "PurchaseItem" pi
       SET "lineNo" = ranked."lineNo"
      FROM ranked
     WHERE ranked."id" = pi."id"
  `;

  console.log(`Updated ${result} PurchaseItem rows.`);
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
