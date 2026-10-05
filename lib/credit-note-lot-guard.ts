// Guard for reversing the lots a RETURN credit note brought back (cancel, or an edit that
// rewrites lines). Reversal takes the returned quantity back out of LotBalance — a RET- lot
// is deleted outright, a merged lot is decremented with a clamp at zero. When later documents
// already used that stock, reversal would leave lot totals above Product.stock and sales
// pointing at a lot that no longer exists, so the mutation is blocked instead.

import type { MutationBlockReference, MutationBlockResult } from "@/lib/document-mutation-guard";

type FindMany = { findMany(args: Record<string, unknown>): Promise<Array<Record<string, unknown>>> };

export type CreditNoteLotGuardDb = {
  creditNoteItemLot?: FindMany;
  lotBalance?: FindMany;
  saleItemLot?: FindMany;
  purchaseReturnItemLot?: FindMany;
  stockMovementLot?: FindMany;
};

const QTY_TOLERANCE = 0.0001;
const MAX_STOCK_DOC_NOS = 5;
const RESTOCK = "RESTOCK";
const ACTIVE = "ACTIVE";

type Shortfall = { productId: string; lotNo: string; cnNo: string; cnDate: Date };

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const lotKey = (productId: string, lotNo: string): string => `${productId}\u0000${lotNo}`;

const allow = (): MutationBlockResult => ({ blocked: false, reason: null, references: [] });

/** The reason shown after "ไม่สามารถดำเนินการได้ เนื่องจาก". */
export const buildCreditNoteLotUsedReason = (lotNos: readonly string[]): string =>
  `Lot ${lotNos.join(", ")} ที่รับคืนถูกนำไปใช้ต่อแล้ว ยอดคงเหลือของ Lot ไม่พอให้ถอนคืน กรุณายกเลิกเอกสารที่ใช้ Lot ก่อน`;

/** Edit-page warning: only lines that are changed or removed are reversed, so the edit itself may still pass. */
export function buildCreditNoteLotEditWarning(result: MutationBlockResult): string | null {
  if (!result.blocked || !result.reason) return null;
  const refs = result.references.map((ref) => ref.refNo).join(", ");
  return `หากแก้ไขหรือลบรายการที่รับคืนเป็น Lot จะบันทึกไม่ได้ เนื่องจาก${result.reason}${refs ? `: ${refs}` : ""}`;
}

async function findShortfalls(
  database: CreditNoteLotGuardDb,
  scope: { creditNoteId: string } | { creditNoteItemIds: readonly string[] },
): Promise<Shortfall[]> {
  const itemWhere = "creditNoteId" in scope
    ? { creditNoteId: scope.creditNoteId }
    : { id: { in: [...scope.creditNoteItemIds] } };
  if (!("creditNoteId" in scope) && scope.creditNoteItemIds.length === 0) return [];
  const lots = await database.creditNoteItemLot?.findMany({
    where: { creditNoteItem: { ...itemWhere, stockDisposition: RESTOCK } },
    select: {
      lotNo: true,
      qty: true,
      creditNoteItem: {
        select: { productId: true, creditNote: { select: { cnNo: true, cnDate: true } } },
      },
    },
  }) ?? [];

  const needed = new Map<string, Shortfall & { qty: number }>();
  for (const lot of lots) {
    const item = record(lot.creditNoteItem);
    const creditNote = record(item?.creditNote);
    const productId = text(item?.productId);
    const lotNo = text(lot.lotNo);
    if (!productId || !lotNo || !(creditNote?.cnDate instanceof Date)) continue;
    const key = lotKey(productId, lotNo);
    const entry = needed.get(key) ?? { productId, lotNo, cnNo: text(creditNote.cnNo), cnDate: creditNote.cnDate, qty: 0 };
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
  return [...needed.entries()]
    .filter(([key, entry]) => entry.qty > (onHand.get(key) ?? 0) + QTY_TOLERANCE)
    .map(([, { productId, lotNo, cnNo, cnDate }]) => ({ productId, lotNo, cnNo, cnDate }));
}

/** ACTIVE documents dated on or after the credit note that took the lot out. */
async function findLotUsers(database: CreditNoteLotGuardDb, shortfall: Shortfall): Promise<MutationBlockReference[]> {
  const { productId, lotNo, cnNo, cnDate } = shortfall;
  const saleLots = await database.saleItemLot?.findMany({
    where: { lotNo, saleItem: { productId, sale: { status: ACTIVE, saleDate: { gte: cnDate } } } },
    select: { saleItem: { select: { sale: { select: { id: true, saleNo: true } } } } },
  }) ?? [];
  const returnLots = await database.purchaseReturnItemLot?.findMany({
    where: { lotNo, purchaseReturnItem: { productId, purchaseReturn: { status: ACTIVE, returnDate: { gte: cnDate } } } },
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
    where: { lotNo, qtyOut: { gt: 0 }, stockCard: { productId, docDate: { gte: cnDate }, docNo: { not: cnNo } } },
    select: { stockCard: { select: { docNo: true } } },
  }) ?? [];
  const docNos = [...new Set(movements.map((row) => text(record(row.stockCard)?.docNo)).filter(Boolean))];
  const label = docNos.length > 0
    ? docNos.slice(0, MAX_STOCK_DOC_NOS).join(", ") + (docNos.length > MAX_STOCK_DOC_NOS ? " …" : "")
    : `การ์ดสต๊อก Lot ${lotNo}`;
  return [{ entityType: "StockCard", id: productId, refNo: label }];
}

/**
 * Blocks when any lot the credit note (or the given lines) would take back out of
 * LotBalance has less on hand than the returned quantity, naming the documents that
 * used it. Only RESTOCK lines carry lots that are reversed.
 */
export async function checkCreditNoteLotReversal(
  database: CreditNoteLotGuardDb,
  scope: { creditNoteId: string } | { creditNoteItemIds: readonly string[] },
): Promise<MutationBlockResult> {
  const shortfalls = await findShortfalls(database, scope);
  if (shortfalls.length === 0) return allow();
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
  return {
    blocked: true,
    reason: buildCreditNoteLotUsedReason([...new Set(shortfalls.map((shortfall) => shortfall.lotNo))]),
    references,
  };
}
