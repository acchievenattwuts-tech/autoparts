// Guard for cancelling a purchase whose lots went into LotBalance (I3, owner 2026-11-12). Cancel takes
// every purchased lot quantity back out of LotBalance. When later documents already used that stock the
// lot cannot cover it, and the reversal used to clamp it at zero, leaving lot totals above Product.stock.
// The cancel is blocked before any write instead, naming the documents that used the lot — the same rule
// and wording as the credit-note guard (lib/credit-note-lot-guard.ts). Editing a purchase nets the lot
// change instead (purchase-lot-reversal.ts); checkPurchaseLotEdit blocks an edit that would leave a lot
// under what was already used from it (owner 2026-11-12), from the same lot reads.

import type { MutationBlockReference, MutationBlockResult } from "@/lib/document-mutation-guard";
import { isInventoryTracked } from "@/lib/inventory-tracking";
import { formatItemQuantity, ITEM_QUANTITY_INPUT_DECIMALS, roundItemQuantity } from "@/lib/item-quantity";

type FindMany = { findMany(args: Record<string, unknown>): Promise<Array<Record<string, unknown>>> };

export type PurchaseLotGuardDb = {
  purchaseItemLot?: FindMany;
  lotBalance?: FindMany;
  saleItemLot?: FindMany;
  purchaseReturnItemLot?: FindMany;
  stockMovementLot?: FindMany;
};

const QTY_TOLERANCE = 0.0001;
const MAX_STOCK_DOC_NOS = 5;
const ACTIVE = "ACTIVE";

type Shortfall = { productId: string; lotNo: string; purchaseNo: string; purchaseDate: Date };

/** One (product, lot) of the purchase: base quantity it brought in and what LotBalance holds now. */
type PurchaseLot = Shortfall & { qty: number; onHand: number; lotControlled: boolean; unitName: string };

/** A lot the edit would leave under what was already used from it (base units). */
type EditShortfall = Shortfall & { used: number; unitName: string };

/** A lot quantity of the edited purchase lines, in base units (lot qty × unit scale, as written). */
export type PurchaseLotEditLine = { productId: string; lotNo: string; qtyInBase: number };

const QTY_INPUT_FACTOR = 10 ** ITEM_QUANTITY_INPUT_DECIMALS;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const lotKey = (productId: string, lotNo: string): string => `${productId}\u0000${lotNo}`;

const allow = (): MutationBlockResult => ({ blocked: false, reason: null, references: [] });

/** The reason shown after "ไม่สามารถดำเนินการได้ เนื่องจาก". */
export const buildPurchaseLotUsedReason = (lotNos: readonly string[]): string =>
  `Lot ${lotNos.join(", ")} ที่รับเข้าจากใบซื้อนี้ถูกนำไปใช้ต่อแล้ว ยอดคงเหลือของ Lot ไม่พอให้ถอนออก กรุณายกเลิกเอกสารที่ใช้ Lot ก่อน`;

const formatLotQty = (qty: number, unitName: string): string =>
  unitName ? `${formatItemQuantity(qty)} ${unitName}` : formatItemQuantity(qty);

/** Smallest quantity a user can key (2 decimals) that still covers `used`. */
const minimumLotQty = (used: number): number => Math.ceil(roundItemQuantity(used) * QTY_INPUT_FACTOR) / QTY_INPUT_FACTOR;

/** Edit reason (after "ไม่สามารถดำเนินการได้ เนื่องจาก"): each lot, what was used, the lowest quantity allowed. */
export const buildPurchaseLotEditReason = (
  lots: readonly { lotNo: string; used: number; unitName: string }[],
): string => {
  const detail = lots
    .map(({ lotNo, used, unitName }) =>
      `${lotNo} (ใช้ไปแล้ว ${formatLotQty(used, unitName)} ต้องไม่ต่ำกว่า ${formatLotQty(minimumLotQty(used), unitName)})`)
    .join(", ");
  return `Lot ${detail} ที่รับเข้าจากใบซื้อนี้ถูกนำไปใช้ต่อแล้ว กรุณาแก้จำนวนไม่ให้ต่ำกว่าที่ใช้ไป หรือยกเลิกเอกสารที่ใช้ Lot ก่อน`;
};

/** Edit-page warning from the same check: the edit itself passes while every lot stays at or above its minimum. */
export function buildPurchaseLotEditWarning(result: MutationBlockResult): string | null {
  if (!result.blocked || !result.reason) return null;
  const refs = result.references.map((ref) => ref.refNo).join(", ");
  return `หากแก้จำนวน Lot ให้ต่ำกว่าที่ใช้ไป ลบรายการ หรือเปลี่ยนเลข Lot สินค้า หรือหน่วย จะบันทึกไม่ได้ เนื่องจาก${result.reason}${refs ? `: ${refs}` : ""}`;
}

/** The lots of the purchase (one read of its lot rows, one of their balances) — shared by cancel and edit. */
async function loadPurchaseLots(database: PurchaseLotGuardDb, purchaseId: string): Promise<PurchaseLot[]> {
  const lots = await database.purchaseItemLot?.findMany({
    where: { purchaseItem: { purchaseId } },
    select: {
      lotNo: true,
      qty: true,
      purchaseItem: {
        select: {
          productId: true,
          product: {
            select: {
              inventoryTracking: true,
              isLotControl: true,
              units: { where: { isBase: true }, select: { name: true }, take: 1 },
            },
          },
          purchase: { select: { purchaseNo: true, purchaseDate: true } },
        },
      },
    },
  }) ?? [];

  const needed = new Map<string, Omit<PurchaseLot, "onHand">>();
  for (const lot of lots) {
    const item = record(lot.purchaseItem);
    const purchase = record(item?.purchase);
    const product = record(item?.product);
    const productId = text(item?.productId);
    const lotNo = text(lot.lotNo);
    if (!productId || !lotNo || !(purchase?.purchaseDate instanceof Date)) continue;
    const key = lotKey(productId, lotNo);
    const baseUnit = Array.isArray(product?.units) ? record(product.units[0]) : null;
    const entry = needed.get(key) ?? {
      productId, lotNo, purchaseNo: text(purchase.purchaseNo), purchaseDate: purchase.purchaseDate, qty: 0,
      lotControlled: product?.isLotControl === true && isInventoryTracked(text(product.inventoryTracking) || null),
      unitName: text(baseUnit?.name),
    };
    entry.qty += Number(lot.qty ?? 0);
    needed.set(key, entry);
  }
  if (needed.size === 0) return [];

  const balances = await database.lotBalance?.findMany({
    where: { OR: [...needed.values()].map(({ productId, lotNo }) => ({ productId, lotNo })) },
    select: { productId: true, lotNo: true, qtyOnHand: true },
  }) ?? [];
  const onHand = new Map(
    balances.map((row) => [lotKey(text(row.productId), text(row.lotNo)), Number(row.qtyOnHand ?? 0)]),
  );
  return [...needed.entries()].map(([key, entry]) => ({ ...entry, onHand: onHand.get(key) ?? 0 }));
}

const toShortfall = ({ productId, lotNo, purchaseNo, purchaseDate }: Shortfall): Shortfall =>
  ({ productId, lotNo, purchaseNo, purchaseDate });

async function findShortfalls(database: PurchaseLotGuardDb, purchaseId: string): Promise<Shortfall[]> {
  return (await loadPurchaseLots(database, purchaseId))
    .filter((lot) => lot.qty > lot.onHand + QTY_TOLERANCE)
    .map(toShortfall);
}

/**
 * Lots of a lot-controlled product the edit would leave below what was already used from them:
 * used = purchased − on hand, and the edit leaves on hand − purchased + new quantity (the netted
 * reversal of purchase-lot-reversal.ts), so it falls short exactly when new quantity < used.
 */
async function findEditShortfalls(
  database: PurchaseLotGuardDb,
  purchaseId: string,
  newLots: readonly PurchaseLotEditLine[],
): Promise<EditShortfall[]> {
  const newQty = new Map<string, number>();
  for (const lot of newLots) {
    const key = lotKey(lot.productId, lot.lotNo);
    newQty.set(key, (newQty.get(key) ?? 0) + lot.qtyInBase);
  }
  return (await loadPurchaseLots(database, purchaseId)).flatMap((lot): EditShortfall[] => {
    const used = lot.qty - lot.onHand;
    if (!lot.lotControlled || used <= QTY_TOLERANCE) return [];
    if ((newQty.get(lotKey(lot.productId, lot.lotNo)) ?? 0) + QTY_TOLERANCE >= used) return [];
    return [{ ...toShortfall(lot), used, unitName: lot.unitName }];
  });
}

/** ACTIVE documents dated on or after the purchase that took the lot out. */
async function findLotUsers(database: PurchaseLotGuardDb, shortfall: Shortfall): Promise<MutationBlockReference[]> {
  const { productId, lotNo, purchaseNo, purchaseDate } = shortfall;
  const saleLots = await database.saleItemLot?.findMany({
    where: { lotNo, saleItem: { productId, sale: { status: ACTIVE, saleDate: { gte: purchaseDate } } } },
    select: { saleItem: { select: { sale: { select: { id: true, saleNo: true } } } } },
  }) ?? [];
  const returnLots = await database.purchaseReturnItemLot?.findMany({
    where: { lotNo, purchaseReturnItem: { productId, purchaseReturn: { status: ACTIVE, returnDate: { gte: purchaseDate } } } },
    select: { purchaseReturnItem: { select: { purchaseReturn: { select: { id: true, returnNo: true } } } } },
  }) ?? [];
  const refs: MutationBlockReference[] = [
    ...saleLots.flatMap((row): MutationBlockReference[] => {
      const sale = record(record(row.saleItem)?.sale);
      return sale && text(sale.id) && text(sale.saleNo)
        ? [{ entityType: "Sale", id: text(sale.id), refNo: text(sale.saleNo) }]
        : [];
    }),
    ...returnLots.flatMap((row): MutationBlockReference[] => {
      const purchaseReturn = record(record(row.purchaseReturnItem)?.purchaseReturn);
      return purchaseReturn && text(purchaseReturn.id) && text(purchaseReturn.returnNo)
        ? [{ entityType: "PurchaseReturn", id: text(purchaseReturn.id), refNo: text(purchaseReturn.returnNo) }]
        : [];
    }),
  ];
  if (refs.length > 0) return refs;

  // Other lot users (adjustment, warranty claim): name them from the stock card.
  const movements = await database.stockMovementLot?.findMany({
    where: { lotNo, qtyOut: { gt: 0 }, stockCard: { productId, docDate: { gte: purchaseDate }, docNo: { not: purchaseNo } } },
    select: { stockCard: { select: { docNo: true } } },
  }) ?? [];
  const docNos = [...new Set(movements.map((row) => text(record(row.stockCard)?.docNo)).filter(Boolean))];
  const label = docNos.length > 0
    ? docNos.slice(0, MAX_STOCK_DOC_NOS).join(", ") + (docNos.length > MAX_STOCK_DOC_NOS ? " …" : "")
    : `การ์ดสต๊อก Lot ${lotNo}`;
  return [{ entityType: "StockCard", id: productId, refNo: label }];
}

/**
 * Blocks when any lot the purchase brought in has less on hand than the purchased quantity the cancel
 * would take back out, naming the documents that used it. A purchase without lots reads one empty list.
 */
export async function checkPurchaseLotReversal(
  database: PurchaseLotGuardDb,
  scope: { purchaseId: string },
): Promise<MutationBlockResult> {
  try {
    const shortfalls = await findShortfalls(database, scope.purchaseId);
    if (shortfalls.length === 0) return allow();
    return {
      blocked: true,
      reason: buildPurchaseLotUsedReason([...new Set(shortfalls.map((shortfall) => shortfall.lotNo))]),
      references: await findAllLotUsers(database, shortfalls),
    };
  } catch (error) {
    console.error("[checkPurchaseLotReversal]", error);
    throw error;
  }
}

/** The documents that used any of the lots, each named once. */
async function findAllLotUsers(
  database: PurchaseLotGuardDb,
  shortfalls: readonly Shortfall[],
): Promise<MutationBlockReference[]> {
  const references: MutationBlockReference[] = [];
  const seen = new Set<string>();
  for (const shortfall of shortfalls) {
    for (const ref of await findLotUsers(database, shortfall)) {
      const key = `${ref.entityType}:${ref.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      references.push(ref);
    }
  }
  return references;
}

/**
 * I3 edit (owner 2026-11-12): blocks a purchase edit that would leave any lot of a lot-controlled product
 * with less than was already used from it — a lower lot quantity, or the line / lot removed, the lot
 * renamed, or the product / unit changed so its base quantity drops. `newLots` are the lot quantities of
 * every line the edited purchase will hold. Lots nothing was used from, lots kept at or above what was
 * used, and products that are not lot-controlled never block. An empty `newLots` names every lot already
 * used and its minimum (the edit page warning).
 */
export async function checkPurchaseLotEdit(
  database: PurchaseLotGuardDb,
  scope: { purchaseId: string; newLots: readonly PurchaseLotEditLine[] },
): Promise<MutationBlockResult> {
  try {
    const shortfalls = await findEditShortfalls(database, scope.purchaseId, scope.newLots);
    if (shortfalls.length === 0) return allow();
    return {
      blocked: true,
      reason: buildPurchaseLotEditReason(shortfalls),
      references: await findAllLotUsers(database, shortfalls),
    };
  } catch (error) {
    console.error("[checkPurchaseLotEdit]", error);
    throw error;
  }
}
