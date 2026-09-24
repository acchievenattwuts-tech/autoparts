import { CNSettlementType, DocStatus, Prisma, type SaleChannel } from "@/lib/generated/prisma";

/**
 * Row locks and re-validation for the sales / credit notes a new marketplace
 * settlement (รอบรับเงิน) is about to claim.
 *
 * createMarketplaceSettlement reads the selected documents BEFORE its
 * transaction. A sale or credit note cancelled, edited, or claimed by another
 * settlement after that read would otherwise still be written into this one.
 * Inside the transaction, before any write, every selected row is locked and
 * checked again with the same eligibility rules as the pre-check.
 *
 * Lock order: CreditNote → Sale (ids sorted within each), the same order the
 * receipt flows use (lockReceiptSettlementDocuments). cancelSale / updateSale
 * lock only the Sale row (prepareSaleQuotationReference) and re-run the mutation
 * guard — which reads active settlement lines — under that lock; cancel/update
 * of a credit note lock the CreditNote row first and only reach the Sale through
 * the FK after it. No flow locks a CreditNote while holding a Sale lock, so the
 * two orders cannot form a cycle.
 */

export type SettlementSaleSnapshot = { id: string; saleNo: string; netAmount: Prisma.Decimal | number };
export type SettlementCreditNoteSnapshot = { id: string; cnNo: string; totalAmount: Prisma.Decimal | number };

type LockedDocumentRow = { id: string; status: string };
type EligibleDocumentRow = { id: string; amount: number };

type SettlementDocumentTx = Pick<Prisma.TransactionClient, "$queryRaw" | "sale" | "creditNote">;

/** Raised inside the create transaction when a selected document is no longer eligible under its row lock. */
export class MarketplaceSettlementDocumentsChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketplaceSettlementDocumentsChangedError";
  }
}

/** Shared by the pre-check and the in-transaction re-check so both enforce the same rules. */
export function buildEligibleSettlementSaleWhere(
  channel: SaleChannel,
  holdingAccountId: string,
  saleIds: string[],
): Prisma.SaleWhereInput {
  return {
    id: { in: saleIds },
    channel,
    status: DocStatus.ACTIVE,
    cashBankAccountId: holdingAccountId,
    marketplaceSettlementLines: { none: { activeSaleId: { not: null } } },
  };
}

export function buildEligibleSettlementCreditNoteWhere(
  channel: SaleChannel,
  holdingAccountId: string,
  creditNoteIds: string[],
): Prisma.CreditNoteWhereInput {
  return {
    id: { in: creditNoteIds },
    channel,
    status: DocStatus.ACTIVE,
    settlementType: CNSettlementType.CASH_REFUND,
    cashBankAccountId: holdingAccountId,
    marketplaceSettlementLines: { none: { activeCreditNoteId: { not: null } } },
  };
}

const sortedUniqueIds = (ids: string[]): string[] => [...new Set(ids)].sort();

async function lockCreditNotesForSettlement(
  tx: SettlementDocumentTx,
  creditNoteIds: string[],
): Promise<LockedDocumentRow[]> {
  const ids = sortedUniqueIds(creditNoteIds);
  if (ids.length === 0) return [];
  return tx.$queryRaw<LockedDocumentRow[]>(Prisma.sql`
    SELECT id, "status"::text AS "status"
    FROM "CreditNote"
    WHERE id IN (${Prisma.join(ids)})
    ORDER BY id
    FOR UPDATE
  `);
}

async function lockSalesForSettlement(
  tx: SettlementDocumentTx,
  saleIds: string[],
): Promise<LockedDocumentRow[]> {
  const ids = sortedUniqueIds(saleIds);
  if (ids.length === 0) return [];
  return tx.$queryRaw<LockedDocumentRow[]>(Prisma.sql`
    SELECT id, "status"::text AS "status"
    FROM "Sale"
    WHERE id IN (${Prisma.join(ids)})
    ORDER BY id
    FOR UPDATE
  `);
}

const toCents = (value: Prisma.Decimal | number): number => Math.round(Number(value) * 100);

type DocumentProblems = { cancelled: string[]; unavailable: string[]; amountChanged: string[] };

/**
 * Classifies each pre-read document against what the transaction sees under the lock:
 * not ACTIVE (or gone) → cancelled; ACTIVE but failing the eligibility filter
 * (already in an active settlement, account/channel/refund type changed) → unavailable;
 * eligible but a different amount than the settlement was calculated from → amountChanged.
 */
export function classifySettlementDocumentProblems(
  expected: { id: string; docNo: string; amount: Prisma.Decimal | number }[],
  locked: LockedDocumentRow[],
  eligible: EligibleDocumentRow[],
): DocumentProblems {
  const statusById = new Map(locked.map((row) => [row.id, row.status]));
  const eligibleById = new Map(eligible.map((row) => [row.id, row]));
  const problems: DocumentProblems = { cancelled: [], unavailable: [], amountChanged: [] };
  for (const doc of expected) {
    const status = statusById.get(doc.id);
    const current = eligibleById.get(doc.id);
    if (status !== DocStatus.ACTIVE) problems.cancelled.push(doc.docNo);
    else if (!current) problems.unavailable.push(doc.docNo);
    else if (toCents(current.amount) !== toCents(doc.amount)) problems.amountChanged.push(doc.docNo);
  }
  return problems;
}

/** Thai message naming every affected document number, or null when nothing changed. */
export function buildSettlementDocumentsChangedMessage(problems: DocumentProblems): string | null {
  const parts = [
    problems.cancelled.length > 0 ? `ถูกยกเลิกแล้ว: ${problems.cancelled.join(", ")}` : null,
    problems.unavailable.length > 0
      ? `ถูกกระทบยอดในรอบอื่นแล้วหรือไม่พร้อมกระทบยอด: ${problems.unavailable.join(", ")}`
      : null,
    problems.amountChanged.length > 0 ? `ยอดเงินถูกแก้ไข: ${problems.amountChanged.join(", ")}` : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  return `มีเอกสารเปลี่ยนแปลงระหว่างบันทึกรอบรับเงิน — ${parts.join(" · ")} กรุณาโหลดหน้าใหม่แล้วเลือกเอกสารอีกครั้ง`;
}

/**
 * Locks the selected CreditNote rows, then Sale rows, and re-checks them with the
 * pre-check rules. Throws MarketplaceSettlementDocumentsChangedError (before any
 * write) when a document was cancelled, claimed by another settlement, made
 * ineligible, or had its amount edited after the pre-check read.
 */
export async function lockAndRevalidateSettlementDocuments(
  tx: SettlementDocumentTx,
  input: {
    channel: SaleChannel;
    holdingAccountId: string;
    sales: SettlementSaleSnapshot[];
    creditNotes: SettlementCreditNoteSnapshot[];
  },
): Promise<void> {
  const saleIds = input.sales.map((sale) => sale.id);
  const creditNoteIds = input.creditNotes.map((creditNote) => creditNote.id);

  const lockedCreditNotes = await lockCreditNotesForSettlement(tx, creditNoteIds);
  const lockedSales = await lockSalesForSettlement(tx, saleIds);

  const eligibleCreditNotes =
    creditNoteIds.length === 0
      ? []
      : await tx.creditNote.findMany({
          where: buildEligibleSettlementCreditNoteWhere(input.channel, input.holdingAccountId, creditNoteIds),
          select: { id: true, totalAmount: true },
        });
  const eligibleSales =
    saleIds.length === 0
      ? []
      : await tx.sale.findMany({
          where: buildEligibleSettlementSaleWhere(input.channel, input.holdingAccountId, saleIds),
          select: { id: true, netAmount: true },
        });

  const creditNoteProblems = classifySettlementDocumentProblems(
    input.creditNotes.map((cn) => ({ id: cn.id, docNo: cn.cnNo, amount: cn.totalAmount })),
    lockedCreditNotes,
    eligibleCreditNotes.map((cn) => ({ id: cn.id, amount: Number(cn.totalAmount) })),
  );
  const saleProblems = classifySettlementDocumentProblems(
    input.sales.map((sale) => ({ id: sale.id, docNo: sale.saleNo, amount: sale.netAmount })),
    lockedSales,
    eligibleSales.map((sale) => ({ id: sale.id, amount: Number(sale.netAmount) })),
  );

  const message = buildSettlementDocumentsChangedMessage({
    cancelled: [...saleProblems.cancelled, ...creditNoteProblems.cancelled],
    unavailable: [...saleProblems.unavailable, ...creditNoteProblems.unavailable],
    amountChanged: [...saleProblems.amountChanged, ...creditNoteProblems.amountChanged],
  });
  if (message) throw new MarketplaceSettlementDocumentsChangedError(message);
}
