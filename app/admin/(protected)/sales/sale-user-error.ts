import type { Prisma } from "@/lib/generated/prisma";
import {
  buildMutationBlockMessage,
  createDocumentMutationGuard,
  type DocumentMutationAction,
  type GuardDb,
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
 */
export async function assertSaleMutationAllowedInTx(
  tx: Prisma.TransactionClient,
  saleId: string,
  action: Extract<DocumentMutationAction, "update" | "cancel">,
): Promise<void> {
  const guard = await createDocumentMutationGuard(tx as unknown as GuardDb).check("Sale", saleId, action);
  if (!guard.blocked) return;
  throw new SaleMutationBlockedError(
    buildMutationBlockMessage(guard) ?? SALE_MUTATION_BLOCKED_FALLBACK_MESSAGE,
  );
}
