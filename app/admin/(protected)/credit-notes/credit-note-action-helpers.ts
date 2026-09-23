import type { dbTx } from "@/lib/db";
import { CreditNoteType, type InventoryTracking, Prisma } from "@/lib/generated/prisma";

type CreditNoteTxClient = Parameters<Parameters<typeof dbTx>[0]>[0];

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
