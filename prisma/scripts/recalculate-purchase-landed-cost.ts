/**
 * recalculate-purchase-landed-cost.ts
 *
 * One-time migration: re-allocate (shippingFee − discount) into landedCost across
 * line items for every ACTIVE purchase, so the moving-average cost reflects the
 * true net acquisition cost per IAS 2.
 *
 * Old behaviour: only shippingFee was distributed; discount lowered the bill total
 * but did not reduce per-unit cost.
 * New behaviour: trade discount is allocated to lines by line value, alongside shipping.
 *
 * What this script does, per ACTIVE purchase that has shippingFee > 0 OR discount > 0:
 *   1. Recompute allocation = (shippingFee − discount) × lineValue / ΣlineValue
 *   2. UPDATE StockCard.landedCost           = allocation              (signed, total per line)
 *   3. UPDATE PurchaseItem.landedCost        = allocation / quantity   (per base unit)
 *   4. recalculateStockCard(productId)       — rebuild MAVG from scratch for every affected product
 *
 * The allocation is the shared formula in lib/purchase-inventory-cost.ts (owner decision V2).
 * Purchases with separate VAT (vatType ≠ NO_VAT and vatRate > 0) are REFUSED and only listed:
 * their landed cost may hold the input-VAT exclusion of a recoverable INCLUDING_VAT purchase or
 * the non-recoverable VAT of an EXCLUDING_VAT purchase, both decided by the VAT registration date
 * at save time — re-save them from the purchase edit form instead, so this script can never undo it.
 *
 * Usage:
 *   npx tsx prisma/scripts/recalculate-purchase-landed-cost.ts --dry-run
 *   npx tsx prisma/scripts/recalculate-purchase-landed-cost.ts        (writes)
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../../lib/generated/prisma";
import { recalculateStockCard } from "../../lib/stock-card";
import { allocatePurchaseLandedCost } from "../../lib/purchase-inventory-cost";

const DRY_RUN = process.argv.includes("--dry-run");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = new PrismaClient({ adapter });

/** Purchases this script may re-allocate: no separate VAT (see the header comment). */
const WITHOUT_SEPARATE_VAT: Prisma.PurchaseWhereInput = { OR: [{ vatType: "NO_VAT" }, { vatRate: 0 }] };

async function main() {
  console.log(DRY_RUN ? "🔍 DRY RUN — no changes will be written\n" : "✏️  WRITE mode — changes will be persisted\n");

  // Scope: ACTIVE purchases where the allocation outcome could differ from the
  // currently-stored values (i.e. discount > 0). Purchases with only shippingFee
  // already had correct allocation; purchases with discount = 0 = shipping = 0
  // have nothing to allocate.
  const refusedVatPurchases = await db.purchase.findMany({
    where: { status: "ACTIVE", discount: { gt: 0 }, NOT: WITHOUT_SEPARATE_VAT },
    select: { purchaseNo: true, vatType: true, vatRate: true },
    orderBy: { purchaseDate: "asc" },
  });
  if (refusedVatPurchases.length > 0) {
    console.log(`⛔ Refused ${refusedVatPurchases.length} ACTIVE purchases with separate VAT (re-save them from the edit form):`);
    for (const refused of refusedVatPurchases) {
      console.log(`   ${refused.purchaseNo}  ${refused.vatType} ${Number(refused.vatRate)}%`);
    }
    console.log("");
  }

  const purchases = await db.purchase.findMany({
    where: {
      status: "ACTIVE",
      discount: { gt: 0 },
      ...WITHOUT_SEPARATE_VAT,
    },
    select: {
      id: true,
      purchaseNo: true,
      shippingFee: true,
      discount: true,
      vatType: true,
      vatRate: true,
      items: {
        orderBy: { lineNo: "asc" },
        select: {
          id: true,
          productId: true,
          quantity: true,
          costPrice: true,
          landedCost: true,
          product: { select: { code: true, name: true } },
        },
      },
    },
    orderBy: { purchaseDate: "asc" },
  });

  console.log(`Found ${purchases.length} ACTIVE purchases with discount > 0\n`);

  const affectedProducts = new Set<string>();
  let updatedItems = 0;
  let skippedItems = 0;

  for (const purchase of purchases) {
    const shippingFee = Number(purchase.shippingFee);
    const discount = Number(purchase.discount);
    const netAdjustment = shippingFee - discount;

    // Line value uses stored base-unit numbers; quantity * costPrice equals the
    // original (selected qty × selected cost) because Prisma stores qty in base
    // and costPrice per base. No separate VAT here, so the formula is shipping − discount.
    const allocations = allocatePurchaseLandedCost({
      lines: purchase.items.map((item) => ({ qty: Number(item.quantity), costPrice: Number(item.costPrice) })),
      shippingFee,
      discount,
      vatType: purchase.vatType,
      vatRate: Number(purchase.vatRate),
      inputVatRecoverable: false,
    });

    console.log(`📄 ${purchase.purchaseNo}  shipping=${shippingFee}  discount=${discount}  netAdj=${netAdjustment}`);

    for (let i = 0; i < purchase.items.length; i++) {
      const item = purchase.items[i];
      const allocated = allocations[i];
      const quantity = Number(item.quantity);
      const perBase = quantity > 0 ? allocated / quantity : 0;
      const currentLanded = Number(item.landedCost);

      // Find the matching StockCard row for this purchase line
      const stockCardRow = await db.stockCard.findFirst({
        where: {
          docNo: purchase.purchaseNo,
          productId: item.productId,
          source: "PURCHASE",
          referenceId: item.id,
        },
        select: { id: true, landedCost: true },
      });

      const currentStockCardLanded = stockCardRow ? Number(stockCardRow.landedCost) : null;

      console.log(
        `   ${item.product.code.padEnd(8)} alloc=${allocated.toFixed(2).padStart(8)} ` +
        `PI.landedCost: ${currentLanded.toFixed(2)} → ${perBase.toFixed(4)}   ` +
        `SC.landedCost: ${currentStockCardLanded === null ? "n/a" : currentStockCardLanded.toFixed(2)} → ${allocated.toFixed(2)}`,
      );

      affectedProducts.add(item.productId);

      if (DRY_RUN) {
        skippedItems++;
        continue;
      }

      await db.$transaction(async (tx) => {
        if (stockCardRow) {
          await tx.stockCard.update({
            where: { id: stockCardRow.id },
            data: { landedCost: new Prisma.Decimal(allocated) },
          });
        }
        await tx.purchaseItem.update({
          where: { id: item.id },
          data: { landedCost: new Prisma.Decimal(perBase) },
        });
      });
      updatedItems++;
    }
  }

  if (!DRY_RUN && affectedProducts.size > 0) {
    console.log(`\n🔄 Recalculating MAVG for ${affectedProducts.size} products...`);
    let recalculated = 0;
    for (const productId of affectedProducts) {
      await db.$transaction(async (tx) => {
        await recalculateStockCard(tx, productId);
      });
      recalculated++;
      if (recalculated % 10 === 0 || recalculated === affectedProducts.size) {
        console.log(`   ${recalculated}/${affectedProducts.size}`);
      }
    }
  }

  console.log("\n────────────────────────────────────────");
  console.log(`Purchases scanned:   ${purchases.length}`);
  console.log(`Items ${DRY_RUN ? "would update" : "updated   "}:   ${DRY_RUN ? skippedItems : updatedItems}`);
  console.log(`Products affected:   ${affectedProducts.size}`);
  console.log(`MAVG recalculated:   ${DRY_RUN ? "(skipped — dry run)" : affectedProducts.size}`);
  console.log("────────────────────────────────────────");
}

main()
  .catch((err) => {
    console.error("\n❌ Migration failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
