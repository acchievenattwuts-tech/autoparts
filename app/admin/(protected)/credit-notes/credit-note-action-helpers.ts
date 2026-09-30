import type { dbTx } from "@/lib/db";
import {
  buildMutationBlockMessage,
  checkRewrittenStockRows,
  createDocumentMutationGuard,
  lockStockMutationProducts,
  type DocumentMutationAction,
  type GuardDb,
  type RewrittenStockRowsWhere,
} from "@/lib/document-mutation-guard";
import { CreditNoteType, type InventoryTracking, Prisma, VatType } from "@/lib/generated/prisma";
import { VAT_TYPE_LABELS } from "@/lib/vat";

type CreditNoteTxClient = Parameters<Parameters<typeof dbTx>[0]>[0];

/** Raised inside a transaction when a sale-referenced credit note does not use the sale's VAT. */
export class CreditNoteVatMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreditNoteVatMismatchError";
  }
}

/**
 * The referenced sale is missing, cancelled or belongs to another customer. A condition
 * the user can fix, so create/update return the Thai message without a critical alert.
 */
export class CreditNoteSourceSaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreditNoteSourceSaleError";
  }
}

const VAT_RATE_TOLERANCE = 0.0001;

type VatBasis = { vatType: VatType; vatRate: number };

/**
 * A credit note that references a sale must use that sale's VAT: the same VAT type,
 * and the same rate unless the type is NO_VAT (the rate has no effect then). Returns
 * the user-facing message on a mismatch, else null. Credit notes without a sale
 * reference are not checked.
 */
export function getCreditNoteSaleVatMismatchMessage(
  sale: VatBasis & { saleNo: string },
  creditNote: VatBasis,
): string | null {
  const sameType = sale.vatType === creditNote.vatType;
  const sameRate =
    sale.vatType === VatType.NO_VAT ||
    Math.abs(sale.vatRate - creditNote.vatRate) <= VAT_RATE_TOLERANCE;
  if (sameType && sameRate) return null;
  const saleVatLabel =
    sale.vatType === VatType.NO_VAT
      ? VAT_TYPE_LABELS[sale.vatType]
      : `${VAT_TYPE_LABELS[sale.vatType]} ${sale.vatRate}%`;
  return `ภาษีของใบลดหนี้ต้องตรงกับใบขายอ้างอิง ${sale.saleNo} (${saleVatLabel})`;
}

/**
 * Lot rows only matter for RETURN credit notes (stock comes back in). The form
 * seeds an empty lot row for lot-controlled products even when the CN is a
 * DISCOUNT/OTHER, where the lot inputs are hidden — that empty row would fail
 * lot validation and block the save. Drop lot rows for non-RETURN types before
 * validation; nothing downstream reads them for those types.
 */
export function dropLotRowsUnlessReturn<T>(items: T[], type: FormDataEntryValue | null): T[] {
  if (type === CreditNoteType.RETURN || !Array.isArray(items)) return items;
  return items.map((item) =>
    item && typeof item === "object" ? ({ ...item, lotItems: [] } as T) : item,
  );
}

export const creditNoteUnitKey = (productId: string, unitName: string): string =>
  `${productId}\u0000${unitName}`;

export type CreditNoteLineRefs = {
  unitByKey: Map<string, { scale: number }>;
  productById: Map<string, { inventoryTracking: InventoryTracking; isLotControl: boolean }>;
};

/**
 * Loads the unit scale and inventory flags for every credit-note line in two
 * queries. Returns the same values the per-line findUnique calls returned, so the
 * stock, lot and amount maths that use them are unchanged.
 */
export async function loadCreditNoteLineRefs(
  tx: CreditNoteTxClient,
  lines: { productId: string; unitName: string }[],
): Promise<CreditNoteLineRefs> {
  if (lines.length === 0) return { unitByKey: new Map(), productById: new Map() };
  const productIds = [...new Set(lines.map((line) => line.productId))];
  const units = await tx.productUnit.findMany({
    where: { OR: lines.map((line) => ({ productId: line.productId, name: line.unitName })) },
    select: { productId: true, name: true, scale: true },
  });
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, inventoryTracking: true, isLotControl: true },
  });
  return {
    unitByKey: new Map(
      units.map((unit) => [creditNoteUnitKey(unit.productId, unit.name), { scale: unit.scale }]),
    ),
    productById: new Map(
      products.map((product) => [
        product.id,
        { inventoryTracking: product.inventoryTracking, isLotControl: product.isLotControl },
      ]),
    ),
  };
}

/** Raised inside a transaction when the credit note was cancelled by a concurrent request. */
export class CreditNoteNotActiveError extends Error {
  constructor() {
    super("CREDIT_NOTE_NOT_ACTIVE");
    this.name = "CreditNoteNotActiveError";
  }
}

/**
 * Locks the credit note row for the rest of the transaction and re-checks that it
 * is still ACTIVE. The status check before the transaction is not enough on its
 * own: two cancel/update requests for the same document could both pass it and
 * then both reverse its lot balances. With the row locked, the second request
 * waits, sees CANCELLED, and stops before touching any data.
 */
export async function lockActiveCreditNote(
  tx: CreditNoteTxClient,
  creditNoteId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<{ status: string }[]>(
    Prisma.sql`SELECT "status"::text AS "status" FROM "CreditNote" WHERE "id" = ${creditNoteId} FOR UPDATE`,
  );
  if (rows[0]?.status !== "ACTIVE") throw new CreditNoteNotActiveError();
}

/** Raised inside a transaction when the mutation guard blocks the credit note under its row lock. */
export class CreditNoteMutationBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreditNoteMutationBlockedError";
  }
}

/**
 * lockActiveCreditNote, then re-runs the CreditNote mutation guard (ACTIVE receipt,
 * ACTIVE marketplace settlement, ACTIVE carrier return-shipping expense) with the
 * transaction client. The guard before the transaction is only a fast path: a
 * settlement or receipt could claim the credit note after it, and cancel/update
 * would then reverse a document that a live downstream document still uses. The
 * message is the shared guard message, so the action and the detail page agree.
 *
 * Lock order: CreditNote FIRST. createMarketplaceSettlement locks CreditNote →
 * Sale and the receipt flows lock CreditNote → Sale → CustomerAdvance, so every
 * flow takes the CreditNote row before anything else and they cannot deadlock on
 * it. The guard only READS Receipt / MarketplaceSettlement / Expense rows.
 *
 * `extraProductIds` (updateCreditNote: the old and new lines' stock products) are
 * locked in the SAME sorted batch as the credit note's current stock products, so
 * every Product lock of the transaction is taken once, in id order, before the guard.
 * Later re-locks (writeStockCard, recalculateStockCardMany) are then no-ops.
 *
 * `rewrittenStockRows` (updateCreditNote): the credit note's StockCard rows the edit
 * deletes. Only those rows are checked against a later ACTIVE supplier DN on the same
 * SKU, still before any write; a header-only edit passes null.
 */
export async function lockMutableCreditNote(
  tx: CreditNoteTxClient,
  creditNoteId: string,
  action: Extract<DocumentMutationAction, "update" | "cancel">,
  extraProductIds: readonly string[] = [],
  rewrittenStockRows: RewrittenStockRowsWhere | null = null,
): Promise<void> {
  await lockActiveCreditNote(tx, creditNoteId);
  const stockProducts = await tx.stockCard.findMany({
    where: { docNo: { in: (await tx.creditNote.findMany({ where: { id: creditNoteId }, select: { cnNo: true } })).map((row) => row.cnNo) } },
    select: { productId: true }, distinct: ["productId"],
  });
  await lockStockMutationProducts(tx, [...stockProducts.map((row) => row.productId), ...extraProductIds]);
  const guard = await createDocumentMutationGuard(tx as unknown as GuardDb).check(
    "CreditNote",
    creditNoteId,
    action,
  );
  const result = guard.blocked || action !== "update"
    ? guard
    : await checkRewrittenStockRows(tx as unknown as GuardDb, rewrittenStockRows);
  const blockMessage = buildMutationBlockMessage(result);
  if (blockMessage) throw new CreditNoteMutationBlockedError(blockMessage);
}
