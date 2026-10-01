import type { PeriodLockView } from "@/lib/period-lock-view";

/**
 * Y2 (owner 2026-09-30): what saving a purchase-return edit would touch, for the edit form. Client-safe — no server
 * imports. previewPurchaseReturnUpdate (actions.ts) fills it; updatePurchaseReturn re-checks everything.
 */
export type PurchaseReturnEditPreview = {
  /**
   * The declared months among the stored and new return date and, for a DISCOUNT/OTHER return, the ลดราคาซื้อ posting
   * month and the months of the later sales / credit notes the repost restates; null when all are open.
   */
  periodLock: PeriodLockView | null;
  /**
   * Only the note, the credit-note number/date or line remarks changed — in a locked return month, or on a DISCOUNT/OTHER
   * return whose ลดราคาซื้อ then stays as posted (Z3): saved without a reason.
   */
  nonFinancial: boolean;
  /** Later sales whose cost the repost restates; null when not planned (no declared month could be touched). */
  restatement: { saleCount: number; delta: number } | null;
};

export type PurchaseReturnEditLockState = {
  lock: PeriodLockView | null;
  /** An owner holding period_lock.override must give the reason before saving. */
  asksReason: boolean;
  /** Without the override permission the previewed change cannot be saved. */
  blocks: boolean;
};

/**
 * The lock the edit form acts on: the server's lock rejection wins (the reason is asked until a save succeeds), then
 * the preview of the current financial fields, then the page's render-time view (return and posting month) with the
 * form's own financial-change check (usePeriodLockFinancialChange).
 */
export function resolvePurchaseReturnEditLock(input: {
  initial: PeriodLockView | null;
  initialAsksReason: boolean;
  preview: PurchaseReturnEditPreview | null;
  server: PeriodLockView | null;
}): PurchaseReturnEditLockState {
  if (input.server) return { lock: input.server, asksReason: input.server.canOverride, blocks: false };
  if (input.preview) {
    const lock = input.preview.periodLock;
    const financial = lock !== null && !input.preview.nonFinancial;
    return { lock, asksReason: financial && lock.canOverride, blocks: financial && !lock.canOverride };
  }
  return { lock: input.initial, asksReason: input.initialAsksReason, blocks: false };
}

/**
 * Z2 (owner 2026-10-01): before the save preview, the reason is asked for up front only when the return's own month is
 * declared. A declared ลดราคาซื้อ posting month alone (`postingMonthOnly`) is locked by updatePurchaseReturn only when
 * the edit changes the ลดราคาซื้อ values, which the preview decides on save — a payment-only edit needs no reason.
 */
export const asksPurchaseReturnReasonUpfront = (input: { financialChange: boolean; postingMonthOnly: boolean }): boolean =>
  input.financialChange && !input.postingMonthOnly;

/** Z2: the lock section's line while only the ลดราคาซื้อ posting month is declared and no preview has decided yet. */
export const describePurchaseReturnPostingMonthLock = (canOverride: boolean): string =>
  "เดือนที่ลงลดราคาซื้อของใบนี้ประกาศปันผลแล้ว แต่แก้ไขได้ตามปกติ ระบบจะตรวจตอนกดบันทึก ถ้าการแก้เปลี่ยนยอดลดราคาซื้อ" +
  (canOverride ? " จะขอเหตุผลปลดล็อกก่อนบันทึก" : " จะบันทึกไม่ได้ ต้องให้ผู้มีสิทธิ์ปลดล็อกเป็นผู้แก้");

/**
 * Preview before saving only when it can change the outcome: an edit of a financial field, no lock rejection yet (the
 * reason is already asked for) and no reason typed (a reason covers every month the save touches).
 */
export const needsPurchaseReturnEditPreview = (input: {
  financialEdited: boolean;
  hasServerLock: boolean;
  reasonGiven: boolean;
}): boolean => input.financialEdited && !input.hasServerLock && !input.reasonGiven;

const formatSignedMoney = (value: number): string =>
  `${value < 0 ? "-" : "+"}${Math.abs(value).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The later-sale restatement line shown with the lock notice; null when none is planned. */
export const describePurchaseReturnRestatement = (restatement: PurchaseReturnEditPreview["restatement"]): string | null =>
  restatement && restatement.saleCount > 0
    ? `ปรับต้นทุนขายย้อนหลัง ${restatement.saleCount} บิล รวม ${formatSignedMoney(restatement.delta)} บาท`
    : null;
