/**
 * I5 (owner 2026-11-12): a cancel or edit action reads its document before the transaction and then
 * acts on those lines, type and products. After it takes the document's row lock it compares the
 * locked row's `updatedAt` with that read — as the sale actions do (`prepareSaleQuotationReference`
 * in lib/sales-quotation.ts) — so a save committed in between is refused instead of being undone or
 * duplicated with stale data. A normal single-user save reads and locks the same version and passes.
 */

const DOCUMENT_CHANGED_MEANWHILE_TEXT = "ถูกแก้ไขระหว่างดำเนินการ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง";

/** Same wording as the sale flow ("ใบขายถูกแก้ไขระหว่างดำเนินการ ..."), with the document number. */
export const buildDocumentChangedMeanwhileMessage = (documentLabel: string, docNo: string): string =>
  `${documentLabel} ${docNo} ${DOCUMENT_CHANGED_MEANWHILE_TEXT}`;

const toInstant = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return Date.parse(value);
  return Number.NaN;
};

/**
 * True when the `updatedAt` read under the row lock is the version read before the transaction.
 * A missing value on either side counts as changed, so a lost row never passes.
 */
export function isSameDocumentVersion(lockedUpdatedAt: unknown, readUpdatedAt: unknown): boolean {
  const locked = toInstant(lockedUpdatedAt);
  const read = toInstant(readUpdatedAt);
  return Number.isFinite(locked) && Number.isFinite(read) && locked === read;
}
