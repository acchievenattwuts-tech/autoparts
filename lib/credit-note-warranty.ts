import {
  CreditNoteType,
  DocStatus,
  MarketplaceReturnStockDisposition,
  Prisma,
  WarrantyClaimStatus,
  type WarrantyStatus,
} from "@/lib/generated/prisma";

/**
 * A RETURN credit note cancels the warranties of the sold units the shop received back
 * (owner decision 2026-10-03). Cancelled in place — status CANCELLED, linked through
 * Warranty.cancelledByCreditNoteId — so cancelling or editing the CN restores them.
 *
 * - Only goods-received lines count: RESTOCK and DAMAGED_NO_RESTOCK. REFUND_ONLY means the
 *   customer kept the item, so its warranty stays.
 * - A unit with an in-progress claim (DRAFT / SENT_TO_SUPPLIER) is never cut; when the return
 *   cannot be covered without one, the CN is blocked. Closed claims do not block.
 * - Which units: lot matching the returned lots first, then units without claims, then the
 *   highest unitSeq.
 */

/** Dispositions where the shop physically received the item back. */
export const GOODS_RECEIVED_RETURN_DISPOSITIONS: readonly MarketplaceReturnStockDisposition[] = [
  MarketplaceReturnStockDisposition.RESTOCK,
  MarketplaceReturnStockDisposition.DAMAGED_NO_RESTOCK,
];

/** Claim statuses that block cutting the claimed unit's warranty. */
export const IN_PROGRESS_CLAIM_STATUSES: readonly WarrantyClaimStatus[] = [
  WarrantyClaimStatus.DRAFT,
  WarrantyClaimStatus.SENT_TO_SUPPLIER,
];

const QUANTITY_TOLERANCE = 0.0001;

export const buildCreditNoteWarrantyCancelNote = (cnNo: string): string => `คืนสินค้าตามใบลดหนี้ ${cnNo}`;

export const buildInProgressClaimBlockMessage = (claimNos: readonly string[]): string =>
  `ไม่สามารถบันทึกใบลดหนี้คืนสินค้าได้ — สินค้าที่คืนมีใบเคลมที่ยังดำเนินการอยู่: ${claimNos.join(", ")} ` +
  "กรุณาปิดหรือยกเลิกใบเคลมก่อน";

export class CreditNoteWarrantyClaimBlockedError extends Error {
  readonly claimNos: string[];

  constructor(claimNos: readonly string[]) {
    super(buildInProgressClaimBlockMessage(claimNos));
    this.name = "CreditNoteWarrantyClaimBlockedError";
    this.claimNos = [...claimNos];
  }
}

export type ReturnWarrantyUnit = {
  id: string;
  unitSeq: number;
  lotNo: string | null;
  status: WarrantyStatus;
  /** Set when another (or this) credit note already cancelled the unit. */
  cancelledByCreditNoteId: string | null;
  /** Claim numbers of DRAFT / SENT_TO_SUPPLIER claims on the unit. */
  inProgressClaimNos: string[];
  hasAnyClaim: boolean;
};

export type ReturnWarrantyPlanInput = {
  /** Quantity sold on the line, in the line's sale unit. */
  soldUnits: number;
  /** Quantity returned so far on the line by every ACTIVE goods-received RETURN CN, in the sale unit. */
  returnedUnits: number;
  /** Lot numbers of the lots returned by the credit note being synced. */
  returnedLotNos: ReadonlySet<string>;
  /** Every warranty row of the sale line (after this CN's own rows were restored). */
  units: readonly ReturnWarrantyUnit[];
};

export type ReturnWarrantyPlan = { cancelIds: string[]; blockedClaimNos: string[] };

/**
 * How many of the line's warranty rows must be cut after the cumulative return. The rows
 * are spread evenly over the sold quantity, so one manual warranty for a whole line is cut
 * only when the whole line comes back, and per-unit warranties one per returned unit.
 */
export function getTargetCancelledWarrantyCount(soldUnits: number, returnedUnits: number, rowCount: number): number {
  if (rowCount <= 0 || soldUnits <= 0 || returnedUnits <= 0) return 0;
  if (returnedUnits >= soldUnits - QUANTITY_TOLERANCE) return rowCount;
  return Math.min(rowCount, Math.floor((returnedUnits * rowCount) / soldUnits + QUANTITY_TOLERANCE));
}

const compareCandidates =
  (returnedLotNos: ReadonlySet<string>) =>
  (a: ReturnWarrantyUnit, b: ReturnWarrantyUnit): number => {
    const lotA = a.lotNo !== null && returnedLotNos.has(a.lotNo) ? 0 : 1;
    const lotB = b.lotNo !== null && returnedLotNos.has(b.lotNo) ? 0 : 1;
    if (lotA !== lotB) return lotA - lotB;
    if (a.hasAnyClaim !== b.hasAnyClaim) return a.hasAnyClaim ? 1 : -1;
    return b.unitSeq - a.unitSeq;
  };

/** Pure: which warranty rows of one sale line the credit note cancels, or which claims block it. */
export function planReturnWarrantyCancellation(input: ReturnWarrantyPlanInput): ReturnWarrantyPlan {
  const target = getTargetCancelledWarrantyCount(input.soldUnits, input.returnedUnits, input.units.length);
  const alreadyCancelled = input.units.filter((unit) => unit.cancelledByCreditNoteId !== null).length;
  const toCut = Math.max(0, target - alreadyCancelled);
  if (toCut === 0) return { cancelIds: [], blockedClaimNos: [] };

  const activeUnits = input.units.filter((unit) => unit.status === "ACTIVE");
  const eligible = activeUnits
    .filter((unit) => unit.inProgressClaimNos.length === 0)
    .sort(compareCandidates(input.returnedLotNos));
  if (eligible.length < toCut) {
    const blockedClaimNos = [...new Set(activeUnits.flatMap((unit) => unit.inProgressClaimNos))].sort();
    return { cancelIds: [], blockedClaimNos };
  }
  return { cancelIds: eligible.slice(0, toCut).map((unit) => unit.id), blockedClaimNos: [] };
}

/** Sale-unit scale of a line: unitScale, else derived from the shown quantity, else base unit. */
export function getSaleLineUnitScale(line: { quantity: number; showQty: number | null; unitScale: number | null }): number {
  if (line.unitScale !== null && line.unitScale > 0) return line.unitScale;
  if (line.showQty !== null && line.showQty > 0 && line.quantity > 0) return line.quantity / line.showQty;
  return 1;
}

export type CreditNoteWarrantySyncResult = {
  restoredWarrantyIds: string[];
  cancelledWarrantyIds: string[];
};

const lockWarrantyRowsWhere = async (tx: Prisma.TransactionClient, where: Prisma.Sql): Promise<void> => {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Warranty" WHERE ${where} ORDER BY "id" FOR UPDATE`);
};

/** Restores every warranty the credit note cancelled. Safe to call for any CN. */
async function restoreCreditNoteWarranties(
  tx: Prisma.TransactionClient,
  creditNoteId: string,
): Promise<string[]> {
  await lockWarrantyRowsWhere(tx, Prisma.sql`"cancelledByCreditNoteId" = ${creditNoteId}`);
  const rows = await tx.warranty.findMany({
    where: { cancelledByCreditNoteId: creditNoteId },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (rows.length === 0) return [];
  await tx.warranty.updateMany({
    where: { cancelledByCreditNoteId: creditNoteId },
    data: { status: "ACTIVE", cancelledAt: null, cancelNote: null, cancelledByCreditNoteId: null },
  });
  return rows.map((row) => row.id);
}

type ReturnLine = { saleItemId: string; lotNos: string[] };

async function loadGoodsReturnLines(
  tx: Prisma.TransactionClient,
  creditNoteId: string,
): Promise<{ cnNo: string; lines: ReturnLine[] } | null> {
  const cn = await tx.creditNote.findUnique({
    where: { id: creditNoteId },
    select: {
      cnNo: true,
      status: true,
      type: true,
      items: {
        where: {
          saleItemId: { not: null },
          stockDisposition: { in: [...GOODS_RECEIVED_RETURN_DISPOSITIONS] },
        },
        select: { saleItemId: true, lotItems: { select: { lotNo: true } } },
      },
    },
  });
  if (!cn || cn.status !== DocStatus.ACTIVE || cn.type !== CreditNoteType.RETURN) return null;
  const lines = cn.items.flatMap((item) =>
    item.saleItemId ? [{ saleItemId: item.saleItemId, lotNos: item.lotItems.map((lot) => lot.lotNo.trim()) }] : [],
  );
  return { cnNo: cn.cnNo, lines };
}

/**
 * Re-applies the warranty cut of one credit note inside its transaction: restores what it
 * cut before, then — when it is an ACTIVE RETURN — cuts the returned units again from the
 * cumulative return of each referenced sale line. Throws CreditNoteWarrantyClaimBlockedError
 * before writing anything further when an in-progress claim prevents the cut.
 *
 * Locks only Warranty rows (sorted). The claim flow locks Sale → Warranty and never a
 * product, and the CN flows lock products first, so the orders cannot cycle.
 */
export async function syncCreditNoteReturnWarranties(
  tx: Prisma.TransactionClient,
  creditNoteId: string,
): Promise<CreditNoteWarrantySyncResult> {
  const restoredWarrantyIds = await restoreCreditNoteWarranties(tx, creditNoteId);
  const returnInfo = await loadGoodsReturnLines(tx, creditNoteId);
  if (!returnInfo || returnInfo.lines.length === 0) {
    return { restoredWarrantyIds, cancelledWarrantyIds: [] };
  }

  const saleItemIds = [...new Set(returnInfo.lines.map((line) => line.saleItemId))].sort();
  const lotNosBySaleItem = new Map<string, Set<string>>();
  for (const line of returnInfo.lines) {
    const lots = lotNosBySaleItem.get(line.saleItemId) ?? new Set<string>();
    line.lotNos.forEach((lotNo) => lots.add(lotNo));
    lotNosBySaleItem.set(line.saleItemId, lots);
  }

  await lockWarrantyRowsWhere(tx, Prisma.sql`"saleItemId" IN (${Prisma.join(saleItemIds)})`);
  // Sequential reads: an interactive transaction owns one pinned client.
  const saleLines = await tx.saleItem.findMany({
    where: { id: { in: saleItemIds } },
    select: { id: true, quantity: true, showQty: true, unitScale: true },
  });
  const returnedTotals = await tx.creditNoteItem.groupBy({
    by: ["saleItemId"],
    where: {
      saleItemId: { in: saleItemIds },
      stockDisposition: { in: [...GOODS_RECEIVED_RETURN_DISPOSITIONS] },
      creditNote: { status: DocStatus.ACTIVE, type: CreditNoteType.RETURN },
    },
    _sum: { qty: true },
  });
  const warranties = await tx.warranty.findMany({
    where: { saleItemId: { in: saleItemIds } },
    select: {
      id: true,
      saleItemId: true,
      unitSeq: true,
      lotNo: true,
      status: true,
      cancelledByCreditNoteId: true,
      claims: {
        where: { status: { not: WarrantyClaimStatus.CANCELLED } },
        select: { claimNo: true, status: true },
      },
    },
  });

  const returnedBaseBySaleItem = new Map(
    returnedTotals.map((row) => [row.saleItemId ?? "", Number(row._sum.qty ?? 0)]),
  );
  const cancelIds: string[] = [];
  const blockedClaimNos: string[] = [];
  for (const line of saleLines) {
    const scale = getSaleLineUnitScale({
      quantity: Number(line.quantity),
      showQty: line.showQty === null ? null : Number(line.showQty),
      unitScale: line.unitScale === null ? null : Number(line.unitScale),
    });
    const plan = planReturnWarrantyCancellation({
      soldUnits: Number(line.quantity) / scale,
      returnedUnits: (returnedBaseBySaleItem.get(line.id) ?? 0) / scale,
      returnedLotNos: lotNosBySaleItem.get(line.id) ?? new Set<string>(),
      units: warranties
        .filter((warranty) => warranty.saleItemId === line.id)
        .map((warranty) => ({
          id: warranty.id,
          unitSeq: warranty.unitSeq,
          lotNo: warranty.lotNo,
          status: warranty.status,
          cancelledByCreditNoteId: warranty.cancelledByCreditNoteId,
          inProgressClaimNos: warranty.claims
            .filter((claim) => IN_PROGRESS_CLAIM_STATUSES.includes(claim.status))
            .map((claim) => claim.claimNo),
          hasAnyClaim: warranty.claims.length > 0,
        })),
    });
    cancelIds.push(...plan.cancelIds);
    blockedClaimNos.push(...plan.blockedClaimNos);
  }
  if (blockedClaimNos.length > 0) {
    throw new CreditNoteWarrantyClaimBlockedError([...new Set(blockedClaimNos)].sort());
  }
  if (cancelIds.length > 0) {
    await tx.warranty.updateMany({
      where: { id: { in: cancelIds }, status: "ACTIVE" },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelNote: buildCreditNoteWarrantyCancelNote(returnInfo.cnNo),
        cancelledByCreditNoteId: creditNoteId,
      },
    });
  }
  return { restoredWarrantyIds, cancelledWarrantyIds: cancelIds.sort() };
}

/** Audit meta for the CN audit entry; omitted when nothing changed. */
export function toCreditNoteWarrantyAuditMeta(
  result: CreditNoteWarrantySyncResult | null,
): { warranties: CreditNoteWarrantySyncResult } | Record<string, never> {
  if (!result || (result.restoredWarrantyIds.length === 0 && result.cancelledWarrantyIds.length === 0)) return {};
  return { warranties: result };
}
