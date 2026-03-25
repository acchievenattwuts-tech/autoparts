/**
 * db-backup.ts
 * Export all database tables to a timestamped JSON snapshot.
 *
 * Usage:
 *   npx tsx prisma/scripts/db-backup.ts
 *
 * Output: prisma/scripts/snapshots/backup-YYYY-MM-DDTHH-mm-ss.json
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../lib/generated/prisma";
import * as fs from "fs";
import * as path from "path";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: 1,
});
const db = new PrismaClient({ adapter });

async function main() {
  console.log("📦 Starting database backup...\n");

  const snapshot = {
    _meta: {
      createdAt: new Date().toISOString(),
      version: "1.0",
    },

    // ─── Master Data ───────────────────────────────────────
    users: await db.user.findMany(),
    categories: await db.category.findMany(),
    partsBrands: await db.partsBrand.findMany(),
    carBrands: await db.carBrand.findMany(),
    carModels: await db.carModel.findMany(),
    suppliers: await db.supplier.findMany(),
    siteContents: await db.siteContent.findMany(),

    // ─── Products ─────────────────────────────────────────
    products: await db.product.findMany(),
    productUnits: await db.productUnit.findMany(),
    productAliases: await db.productAlias.findMany(),
    productCarModels: await db.productCarModel.findMany(),

    // ─── Transactional Data ───────────────────────────────
    stockCards: await db.stockCard.findMany(),

    purchases: await db.purchase.findMany(),
    purchaseItems: await db.purchaseItem.findMany(),

    sales: await db.sale.findMany(),
    saleItems: await db.saleItem.findMany(),

    adjustments: await db.adjustment.findMany(),
    adjustmentItems: await db.adjustmentItem.findMany(),

    creditNotes: await db.creditNote.findMany(),
    creditNoteItems: await db.creditNoteItem.findMany(),

    purchaseReturns: await db.purchaseReturn.findMany(),
    purchaseReturnItems: await db.purchaseReturnItem.findMany(),

    warranties: await db.warranty.findMany(),
    expenses: await db.expense.findMany(),
  };

  // Create output directory
  const outDir = path.join(__dirname, "snapshots");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile = path.join(outDir, `backup-${timestamp}.json`);

  fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2), "utf-8");

  // Summary
  console.log("✅ Backup complete!\n");
  console.log("📄 File:", outFile);
  console.log("\n📊 Records backed up:");
  const skip = ["_meta"];
  for (const [key, val] of Object.entries(snapshot)) {
    if (skip.includes(key)) continue;
    console.log(`   ${key.padEnd(24)} ${(val as unknown[]).length} rows`);
  }
  console.log("\n💡 To restore: npx tsx prisma/scripts/db-restore.ts", path.basename(outFile));
}

main()
  .catch((err) => { console.error("❌ Backup failed:", err); process.exit(1); })
  .finally(() => db.$disconnect());
