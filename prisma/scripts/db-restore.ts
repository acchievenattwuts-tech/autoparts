/**
 * db-restore.ts
 * Clear ALL data and restore from a backup JSON snapshot.
 *
 * Usage:
 *   npx tsx prisma/scripts/db-restore.ts backup-YYYY-MM-DDTHH-mm-ss.json
 *
 * The snapshot file must be in prisma/scripts/snapshots/
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../lib/generated/prisma";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: 1,
});
const db = new PrismaClient({ adapter });

// ─── Confirmation prompt ─────────────────────────────────────────────────────

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

// ─── Helper: convert Decimal/Date strings back to proper types ──────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    // ISO date strings → Date
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(obj)) return new Date(obj);
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(deserialize);
  if (typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, deserialize(v)])
    );
  }
  return obj;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const fileName = process.argv[2];
  if (!fileName) {
    console.error("❌ Usage: npx tsx prisma/scripts/db-restore.ts <backup-file.json>");
    process.exit(1);
  }

  const filePath = path.join(__dirname, "snapshots", fileName);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const snap = deserialize(raw);

  console.log("\n⚠️  WARNING: This will DELETE ALL current data and restore from:");
  console.log("   File   :", fileName);
  console.log("   Created:", snap._meta?.createdAt ?? "unknown");
  console.log("\n📊 Records to restore:");
  const skip = ["_meta"];
  for (const [key, val] of Object.entries(snap)) {
    if (skip.includes(key)) continue;
    console.log(`   ${key.padEnd(24)} ${(val as unknown[]).length} rows`);
  }

  const ok = await confirm("\n⚡ Type 'y' to confirm restore: ");
  if (!ok) {
    console.log("❌ Restore cancelled.");
    process.exit(0);
  }

  console.log("\n🗑️  Clearing all tables...");

  // Delete in reverse dependency order (children first)
  await db.warranty.deleteMany();
  await db.expense.deleteMany();

  await db.creditNoteItem.deleteMany();
  await db.creditNote.deleteMany();

  await db.purchaseReturnItem.deleteMany();
  await db.purchaseReturn.deleteMany();

  await db.adjustmentItem.deleteMany();
  await db.adjustment.deleteMany();

  await db.saleItem.deleteMany();
  await db.sale.deleteMany();

  await db.purchaseItem.deleteMany();
  await db.purchase.deleteMany();

  await db.stockCard.deleteMany();

  // Product relations
  await db.productCarModel.deleteMany();
  await db.productAlias.deleteMany();
  await db.productUnit.deleteMany();
  await db.product.deleteMany();

  // Master data
  await db.carModel.deleteMany();
  await db.carBrand.deleteMany();
  await db.category.deleteMany();
  await db.partsBrand.deleteMany();
  await db.supplier.deleteMany();
  await db.siteContent.deleteMany();
  await db.user.deleteMany();

  console.log("✅ All tables cleared.\n");
  console.log("📥 Restoring data...");

  // Restore in dependency order (parents first)
  if (snap.users?.length)          { await db.user.createMany({ data: snap.users }); console.log(`   ✓ users (${snap.users.length})`); }
  if (snap.categories?.length)     { await db.category.createMany({ data: snap.categories }); console.log(`   ✓ categories (${snap.categories.length})`); }
  if (snap.partsBrands?.length)    { await db.partsBrand.createMany({ data: snap.partsBrands }); console.log(`   ✓ partsBrands (${snap.partsBrands.length})`); }
  if (snap.carBrands?.length)      { await db.carBrand.createMany({ data: snap.carBrands }); console.log(`   ✓ carBrands (${snap.carBrands.length})`); }
  if (snap.carModels?.length)      { await db.carModel.createMany({ data: snap.carModels }); console.log(`   ✓ carModels (${snap.carModels.length})`); }
  if (snap.suppliers?.length)      { await db.supplier.createMany({ data: snap.suppliers }); console.log(`   ✓ suppliers (${snap.suppliers.length})`); }
  if (snap.siteContents?.length)   { await db.siteContent.createMany({ data: snap.siteContents }); console.log(`   ✓ siteContents (${snap.siteContents.length})`); }

  if (snap.products?.length)       { await db.product.createMany({ data: snap.products }); console.log(`   ✓ products (${snap.products.length})`); }
  if (snap.productUnits?.length)   { await db.productUnit.createMany({ data: snap.productUnits }); console.log(`   ✓ productUnits (${snap.productUnits.length})`); }
  if (snap.productAliases?.length) { await db.productAlias.createMany({ data: snap.productAliases }); console.log(`   ✓ productAliases (${snap.productAliases.length})`); }
  if (snap.productCarModels?.length) { await db.productCarModel.createMany({ data: snap.productCarModels }); console.log(`   ✓ productCarModels (${snap.productCarModels.length})`); }

  if (snap.stockCards?.length)     { await db.stockCard.createMany({ data: snap.stockCards }); console.log(`   ✓ stockCards (${snap.stockCards.length})`); }

  if (snap.purchases?.length)      { await db.purchase.createMany({ data: snap.purchases }); console.log(`   ✓ purchases (${snap.purchases.length})`); }
  if (snap.purchaseItems?.length)  { await db.purchaseItem.createMany({ data: snap.purchaseItems }); console.log(`   ✓ purchaseItems (${snap.purchaseItems.length})`); }

  if (snap.sales?.length)          { await db.sale.createMany({ data: snap.sales }); console.log(`   ✓ sales (${snap.sales.length})`); }
  if (snap.saleItems?.length)      { await db.saleItem.createMany({ data: snap.saleItems }); console.log(`   ✓ saleItems (${snap.saleItems.length})`); }

  if (snap.adjustments?.length)    { await db.adjustment.createMany({ data: snap.adjustments }); console.log(`   ✓ adjustments (${snap.adjustments.length})`); }
  if (snap.adjustmentItems?.length){ await db.adjustmentItem.createMany({ data: snap.adjustmentItems }); console.log(`   ✓ adjustmentItems (${snap.adjustmentItems.length})`); }

  if (snap.creditNotes?.length)    { await db.creditNote.createMany({ data: snap.creditNotes }); console.log(`   ✓ creditNotes (${snap.creditNotes.length})`); }
  if (snap.creditNoteItems?.length){ await db.creditNoteItem.createMany({ data: snap.creditNoteItems }); console.log(`   ✓ creditNoteItems (${snap.creditNoteItems.length})`); }

  if (snap.purchaseReturns?.length)     { await db.purchaseReturn.createMany({ data: snap.purchaseReturns }); console.log(`   ✓ purchaseReturns (${snap.purchaseReturns.length})`); }
  if (snap.purchaseReturnItems?.length) { await db.purchaseReturnItem.createMany({ data: snap.purchaseReturnItems }); console.log(`   ✓ purchaseReturnItems (${snap.purchaseReturnItems.length})`); }

  if (snap.warranties?.length)     { await db.warranty.createMany({ data: snap.warranties }); console.log(`   ✓ warranties (${snap.warranties.length})`); }
  if (snap.expenses?.length)       { await db.expense.createMany({ data: snap.expenses }); console.log(`   ✓ expenses (${snap.expenses.length})`); }

  console.log("\n✅ Restore complete! Database is back to snapshot state.");
}

main()
  .catch((err) => { console.error("❌ Restore failed:", err); process.exit(1); })
  .finally(() => db.$disconnect());
