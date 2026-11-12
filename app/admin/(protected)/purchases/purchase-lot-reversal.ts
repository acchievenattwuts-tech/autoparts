import type { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma";
import type { PurchaseLotEditLine } from "@/lib/purchase-lot-reversal-guard";

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

/**
 * I3 (owner 2026-11-12) — the edit path of updatePurchase: takes the old lines' lot quantities out of
 * LotBalance WITHOUT clamping, so the new lines' lots (writePurchaseLots) are added onto the true
 * balance and the result is the net difference. Lot L1 bought 10, sold 4 (balance 6), purchase edited
 * with the same lots: 6 − 10 + 10 = 6, where the clamped reversal gave 0 + 10 = 10. An edit to less
 * than the 4 used is refused before this runs (checkPurchaseLotEdit). Returns the
 * (product, lot) pairs it touched; call clampPurchaseLotBalances with them after the new lots are
 * written. When nothing of the lot was used (balance ≥ purchased) the result equals the clamped path.
 * Must be called inside a dbTx().
 */
export const reversePurchaseLotBalancesForEdit = async (
  tx: PurchaseLotTxClient,
  items: PurchaseLotReversalItem[],
): Promise<PurchaseLotDecrement[]> => {
  if (items.length === 0) return [];
  const lots = await tx.purchaseItemLot.findMany({
    where: { purchaseItemId: { in: items.map((item) => item.id) } },
    select: { purchaseItemId: true, lotNo: true, qty: true },
  });
  const decrements = aggregatePurchaseLotDecrements(items, lots);
  if (decrements.length === 0) return [];

  const values = Prisma.join(
    decrements.map((d) => Prisma.sql`(
      ${d.productId},
      ${d.lotNo},
      ${d.dec.toString()}::numeric
    )`),
  );
  await tx.$executeRaw`
    UPDATE "LotBalance" AS lb
    SET "qtyOnHand" = lb."qtyOnHand" - d."dec"
    FROM (VALUES ${values}) AS d("productId","lotNo","dec")
    WHERE lb."productId" = d."productId" AND lb."lotNo" = d."lotNo"
  `;
  return decrements;
};

/**
 * The lot quantities, in base units, of every purchase line an edit submits (lot qty × unit scale, as
 * updatePurchase writes them) for checkPurchaseLotEdit. An unknown unit counts as scale 1, as the line
 * signatures do: an unchanged line keeps its stored lots, and a changed one is refused by the
 * transaction ("ไม่พบหน่วยนับ").
 */
export const collectPurchaseEditLots = (
  items: readonly { productId: string; unitName: string; lotItems?: readonly { lotNo: string; qty: number }[] }[],
  scaleOf: (productId: string, unitName: string) => number | undefined,
): PurchaseLotEditLine[] =>
  items.flatMap((item) => {
    const scale = scaleOf(item.productId, item.unitName) ?? 1;
    return (item.lotItems ?? []).map((lot) => ({
      productId: item.productId,
      lotNo: lot.lotNo.trim(),
      qtyInBase: lot.qty * scale,
    }));
  });

/**
 * Final step of the edit path: a lot the edit left below zero is clamped at zero, as every other
 * LotBalance decrement is. For a lot-controlled product updatePurchase has already refused such an edit
 * (checkPurchaseLotEdit); this still covers lots of a product no longer lot-controlled. Only the pairs
 * reversePurchaseLotBalancesForEdit touched are read.
 */
export const clampPurchaseLotBalances = async (
  tx: PurchaseLotTxClient,
  touched: readonly PurchaseLotDecrement[],
): Promise<void> => {
  if (touched.length === 0) return;
  const values = Prisma.join(touched.map((d) => Prisma.sql`(${d.productId}, ${d.lotNo})`));
  await tx.$executeRaw`
    UPDATE "LotBalance" AS lb
    SET "qtyOnHand" = 0
    FROM (VALUES ${values}) AS d("productId","lotNo")
    WHERE lb."productId" = d."productId" AND lb."lotNo" = d."lotNo" AND lb."qtyOnHand" < 0
  `;
};
