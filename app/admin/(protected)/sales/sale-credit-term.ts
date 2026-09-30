/**
 * Owner decision S9: a cash sale leaves nothing owed, so its credit term is not money. In a month
 * whose profit was already distributed, the server's "non-financial change only" comparison
 * (sale-period-lock.ts) and the edit form's reason-field hint (SaleForm) both compare the credit
 * term through this value: ignored on a cash sale — e.g. after picking a customer with another
 * term — and compared as before on a credit sale. Client-safe: no server imports.
 */
export const comparableSaleCreditTerm = (
  paymentType: string,
  creditTerm: number | null | undefined,
): number | null => (paymentType === "CASH_SALE" ? null : creditTerm ?? 0);
