/**
 * Seed the five approved system Price Lists and copy the three legacy Product
 * price columns into ProductPrice without overwriting an existing row.
 *
 * Dry-run (default): npm run backfill:price-lists
 * Apply explicitly:  npm run backfill:price-lists -- --apply
 *
 * Production execution is a deployment action and is not authorized merely by
 * this script existing. Always run dry-run + verifier and obtain owner approval.
 */
import { db } from "../../lib/db";
import {
  getSystemPriceListForLegacyTier,
  SYSTEM_PRICE_LISTS,
  type LegacyPriceTier,
} from "../../lib/pricing/price-lists";

const LEGACY_TIERS = ["WHOLESALE", "MEMBER", "RETAIL"] as const;

const legacyAmount = (
  product: { salePrice: unknown; memberPrice: unknown; retailPrice: unknown },
  tier: LegacyPriceTier,
) => Number(tier === "WHOLESALE" ? product.salePrice : tier === "MEMBER" ? product.memberPrice : product.retailPrice);

async function main() {
  const apply = process.argv.includes("--apply");
  const [products, customerTypes, existingLists, existingPrices] = await Promise.all([
    db.product.findMany({
      select: { id: true, code: true, salePrice: true, memberPrice: true, retailPrice: true },
    }),
    db.customerType.findMany({ select: { id: true, name: true, priceTier: true, priceListId: true } }),
    db.priceList.findMany({ select: { id: true, code: true, name: true, channel: true } }),
    db.productPrice.findMany({
      where: { priceList: { code: { in: [...LEGACY_TIERS] } } },
      select: { productId: true, priceList: { select: { code: true } } },
    }),
  ]);

  const existingCodes = new Set(existingLists.map((row) => row.code));
  const existingPriceKeys = new Set(
    existingPrices.map((row) => `${row.productId}:${row.priceList.code}`),
  );
  const pricesToInsert = products.flatMap((product) =>
    LEGACY_TIERS.filter((tier) => !existingPriceKeys.has(`${product.id}:${tier}`)).map((tier) => ({
      productId: product.id,
      tier,
      amount: legacyAmount(product, tier),
    })),
  );
  const customerTypesToMap = customerTypes.filter((row) => row.priceListId === null);

  console.log(apply ? "APPLY MODE — database writes enabled" : "DRY RUN — no database writes");
  const existingSystemCodeCount = SYSTEM_PRICE_LISTS.filter((definition) => existingCodes.has(definition.code)).length;
  console.log(`System Price Lists: ${existingSystemCodeCount}/${SYSTEM_PRICE_LISTS.length} codes currently present`);
  console.log(`Products: ${products.length}`);
  console.log(`Legacy ProductPrice rows to insert: ${pricesToInsert.length}`);
  console.log(`Customer Types awaiting mapping: ${customerTypesToMap.length}`);

  if (!apply) {
    console.log("Dry-run complete. No data changed.");
    return;
  }

  await db.$transaction(async (tx) => {
    const priceListIdByCode = new Map<string, string>();
    for (const definition of SYSTEM_PRICE_LISTS) {
      const priceList = await tx.priceList.upsert({
        where: { code: definition.code },
        update: {
          name: definition.name,
          channel: definition.channel,
          isActive: true,
          isSystem: true,
          sortOrder: definition.sortOrder,
        },
        create: {
          id: definition.id,
          code: definition.code,
          name: definition.name,
          channel: definition.channel,
          isActive: true,
          isSystem: true,
          sortOrder: definition.sortOrder,
        },
        select: { id: true, code: true },
      });
      priceListIdByCode.set(priceList.code, priceList.id);
    }

    if (pricesToInsert.length > 0) {
      await tx.productPrice.createMany({
        data: pricesToInsert.map((row) => ({
          productId: row.productId,
          priceListId: priceListIdByCode.get(row.tier)!,
          amount: row.amount,
        })),
        skipDuplicates: true,
      });
    }

    for (const customerType of customerTypesToMap) {
      const definition = getSystemPriceListForLegacyTier(customerType.priceTier);
      await tx.customerType.updateMany({
        where: { id: customerType.id, priceListId: null },
        data: { priceListId: priceListIdByCode.get(definition.code)! },
      });
    }
  });

  console.log("Backfill committed. Run npm run verify:price-lists before cutover.");
}

main()
  .catch((error) => {
    console.error("Price List backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
