import type { PeriodLockView } from "@/lib/period-lock-view";

/**
 * X4 (owner 2026-09-30): what cancelling a purchase return would touch, for its cancel dialog. Client-safe — no server
 * imports. previewPurchaseReturnCancel (actions.ts) fills it; cancelPurchaseReturn re-checks everything.
 */
export type PurchaseReturnCancelPreview = {
  /**
   * The declared months among the return month, the ลดราคาซื้อ posting month and the months of the later sales /
   * credit notes whose cost the cancel restates; null when all are open.
   */
  periodLock: PeriodLockView | null;
  /** Later sales whose cost the cancel restates; null when not planned (no declared month could be touched). */
  restatement: { saleCount: number; delta: number } | null;
};

export type PurchaseReturnCancelLockState = {
  lock: PeriodLockView | null;
  /** An owner holding period_lock.override must give a reason before confirming. */
  asksReason: boolean;
  /** Without the override permission a locked month blocks the cancel. */
  blocks: boolean;
};

/**
 * The lock the cancel dialog acts on: the server's rejection wins, then the loaded preview, then the page's
 * render-time view (return and posting month only) while the preview loads or when it failed.
 */
export function resolvePurchaseReturnCancelLock(input: {
  initial: PeriodLockView | null;
  preview: PurchaseReturnCancelPreview | null;
  server: PeriodLockView | null;
}): PurchaseReturnCancelLockState {
  const lock = input.server ?? (input.preview ? input.preview.periodLock : input.initial);
  return { lock, asksReason: Boolean(lock?.canOverride), blocks: Boolean(lock && !lock.canOverride) };
}
