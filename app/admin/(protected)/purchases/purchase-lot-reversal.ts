import type { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma";

type PurchaseLotTxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];

export type PurchaseLotReversalItem = { id: string; productId: string };
export type PurchaseItemLotRow = { purchaseItemId: string; lotNo: string; qty: Prisma.Decimal };
export type PurchaseLotDecrement = { productId: string; lotNo: string; dec: Prisma.Decimal };

/**
 * Sums the lot quantities of the given purchase lines per (product, lot).
 * Rows whose purchase line is not in `items` are ignored.
 */
export const aggregatePurchaseLotDecrements = (
  items: PurchaseLotReversalItem[],
  lots: PurchaseItemLotRow[],
): PurchaseLotDecrement[] => {
  const productByItemId = new Map(items.map((item) => [item.id, item.productId]));
  const decByProductLot = new Map<string, PurchaseLotDecrement>();
  for (const lot of lots) {
    const productId = productByItemId.get(lot.purchaseItemId);
    if (!productId) continue;
    const key = `${productId}\u0000${lot.lotNo}`;
    const existingDec = decByProductLot.get(key);
    if (existingDec) existingDec.dec = existingDec.dec.add(lot.qty);
    else decByProductLot.set(key, { productId, lotNo: lot.lotNo, dec: new Prisma.Decimal(lot.qty) });
  }
  return [...decByProductLot.values()];
};

/**
 * Reverses the LotBalance of every given purchase line in batch: one lookup of
 * all their lot rows, aggregate the decrement per (product, lot), then a single
 * clamped UPDATE. GREATEST(balance - Σqty, 0) equals the per-row
 * decrement-then-clamp sequence of reversePurchaseLotBalance() because every
 * lot qty is non-negative (see purchase-lot-reversal.test.ts).
 * Must be called inside a dbTx().
 */
export const reversePurchaseLotBalancesBatch = async (
  tx: PurchaseLotTxClient,
  items: PurchaseLotReversalItem[],
): Promise<void> => {
  if (items.length === 0) return;
  const lots = await tx.purchaseItemLot.findMany({
    where: { purchaseItemId: { in: items.map((item) => item.id) } },
    select: { purchaseItemId: true, lotNo: true, qty: true },
  });
  const decrements = aggregatePurchaseLotDecrements(items, lots);
  if (decrements.length === 0) return;

  const values = Prisma.join(
    decrements.map((d) => Prisma.sql`(
      ${d.productId},
      ${d.lotNo},
      ${d.dec.toString()}::numeric
    )`),
  );
  await tx.$executeRaw`
    UPDATE "LotBalance" AS lb
    SET "qtyOnHand" = GREATEST(lb."qtyOnHand" - d."dec", 0)
    FROM (VALUES ${values}) AS d("productId","lotNo","dec")
    WHERE lb."productId" = d."productId" AND lb."lotNo" = d."lotNo"
  `;
};
