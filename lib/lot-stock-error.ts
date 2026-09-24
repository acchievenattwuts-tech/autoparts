/**
 * A lot does not hold enough stock for an outgoing movement. The message is
 * user-facing Thai and safe to return from a Server Action as-is — it is a
 * condition the user fixes (pick another lot / lower the qty), not a system
 * failure, so callers must not send it to reportCriticalError.
 *
 * Kept in its own module (not lib/lot-control.ts) so Server Actions and tests
 * can import the class without pulling in the DB client, and so a test that
 * module-mocks lib/lot-control still shares the same class.
 */
export interface LotStockInsufficientDetails {
  productId: string;
  lotNo: string;
  /** Requested quantity in base unit. */
  requestedQty: number;
  /** Quantity on hand in base unit at the time of the check. */
  availableQty: number;
}

export class LotStockInsufficientError extends Error {
  readonly productId: string;
  readonly lotNo: string;
  readonly requestedQty: number;
  readonly availableQty: number;

  constructor(details: LotStockInsufficientDetails) {
    super(`Lot ${details.lotNo} คงเหลือไม่พอสำหรับการตัดสต็อก`);
    this.name = "LotStockInsufficientError";
    this.productId = details.productId;
    this.lotNo = details.lotNo;
    this.requestedQty = details.requestedQty;
    this.availableQty = details.availableQty;
  }
}
