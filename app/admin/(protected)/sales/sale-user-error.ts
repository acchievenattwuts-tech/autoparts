import type { Prisma } from "@/lib/generated/prisma";
import {
  buildMutationBlockMessage,
  checkRewrittenStockRows,
  createDocumentMutationGuard,
  lockStockMutationProducts,
  type DocumentMutationAction,
  type GuardDb,
  type RewrittenStockRowsWhere,
} from "@/lib/document-mutation-guard";

/**
 * A condition the user can act on, raised inside the createSale / updateSale / cancelSale
 * transaction so the whole write rolls back. The action returns its message
 * as-is — without reportCriticalError, which is reserved for system failures.
 *
 * Kept outside the "use server" action file because that may only export
 * async functions.
 */
export class SaleUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaleUserError";
  }
}

/** The Sale mutation guard blocked the update / cancel under the Sale row lock. */
export class SaleMutationBlockedError extends SaleUserError {
  constructor(message: string) {
    super(message);
    this.name = "SaleMutationBlockedError";
  }
}

/** Fallback when the guard blocks without a reason (kept from the previous in-transaction check). */
const SALE_MUTATION_BLOCKED_FALLBACK_MESSAGE = "เอกสารถูกอ้างอิง";

/**
 * Re-runs the Sale mutation guard with the transaction client, after the Sale
 * row lock is held. A downstream document (receipt, credit note, claim, marketplace
 * settlement, delivery commission run) created after the pre-check is caught here,
 * and the user gets the same message the pre-check returns, with its document numbers.
 *
 * `extraProductIds` (updateSale: the old and the new lines' products) are locked in the
 * SAME sorted batch as the Sale's current stock products, so every Product lock of the
 * transaction is taken once, in id order, before the guard — the order purchases and
 * purchase returns use. Later re-locks of these rows (preloadSaleDependencies,
 * writeStockCard, recalculateStockCard) are no-ops for the transaction holding them.
 *
 * `rewrittenStockRows` (updateSale): the Sale's StockCard rows the edit deletes or
 * rewrites. Only those rows are checked against a later ACTIVE supplier DN on the same
 * SKU, under the same locks and before any write; a header-only edit passes null.
 */
export async function assertSaleMutationAllowedInTx(
  tx: Prisma.TransactionClient,
  saleId: string,
  action: Extract<DocumentMutationAction, "update" | "cancel">,
  extraProductIds: readonly string[] = [],
  rewrittenStockRows: RewrittenStockRowsWhere | null = null,
): Promise<void> {
  const stockProducts = await tx.stockCard.findMany({
    where: { docNo: { in: (await tx.sale.findMany({ where: { id: saleId }, select: { saleNo: true } })).map((row) => row.saleNo) } },
    select: { productId: true }, distinct: ["productId"],
  });
  await lockStockMutationProducts(tx, [...stockProducts.map((row) => row.productId), ...extraProductIds]);
  const guard = await createDocumentMutationGuard(tx as unknown as GuardDb).check("Sale", saleId, action);
  const result = guard.blocked || action !== "update"
    ? guard
    : await checkRewrittenStockRows(tx as unknown as GuardDb, rewrittenStockRows);
  if (!result.blocked) return;
  throw new SaleMutationBlockedError(
    buildMutationBlockMessage(result) ?? SALE_MUTATION_BLOCKED_FALLBACK_MESSAGE,
  );
}
