/**
 * A validation failure the user can fix (missing unit, lot rows that do not add up,
 * cancelled source purchase, payment total mismatch, ...). Thrown inside the
 * purchase / purchase-return transactions so the whole write rolls back, then
 * caught by the Server Action and returned as-is to the form — without calling
 * reportCriticalError, which is reserved for real system failures.
 *
 * Kept outside the "use server" action files because those may only export
 * async functions.
 */
export class PurchaseUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurchaseUserError";
  }
}

/** Returns the user-facing message when `error` is a PurchaseUserError, else null. */
export const getPurchaseUserErrorMessage = (error: unknown): string | null =>
  error instanceof PurchaseUserError ? error.message : null;
