/**
 * Client-safe pieces of the profit-distribution month lock (lib/period-lock.ts):
 * the form field that carries an override reason and the shape the edit/cancel
 * pages hand to their client forms. No server imports here — client components use it.
 */

/** FormData field holding the admin's reason for changing a document in a locked month. */
export const PERIOD_LOCK_REASON_FIELD = "periodLockReason";

export const PERIOD_LOCK_REASON_LABEL = "เหตุผลที่แก้เอกสารในเดือนที่ปันผลแล้ว";

/** Same minimum as normalizeOverrideReason() in lib/period-lock.ts (pinned by period-lock-document.test.ts). */
export const PERIOD_LOCK_REASON_MIN_LENGTH = 5;

export const PERIOD_LOCK_REASON_REQUIRED_MESSAGE =
  `กรุณาระบุ${PERIOD_LOCK_REASON_LABEL} อย่างน้อย ${PERIOD_LOCK_REASON_MIN_LENGTH} ตัวอักษร`;

/** Client-side pre-check only; the server re-checks permission and reason. */
export const isPeriodLockReasonLongEnough = (reason: string): boolean =>
  reason.trim().length >= PERIOD_LOCK_REASON_MIN_LENGTH;

/**
 * True when `error` is the server rejecting this document for the month lock: the action's
 * message starts with the same buildPeriodLockMessage() text the page shows in `lock.message`.
 */
export const isPeriodLockRejection = (
  error: string | null | undefined,
  lock: PeriodLockView | null | undefined,
): boolean => Boolean(error && lock && error.startsWith(lock.message));

/** A document dated in a locked month, as shown on its edit/cancel UI. */
export type PeriodLockView = {
  /** buildPeriodLockMessage() — the same text the server returns when it rejects. */
  message: string;
  /** The viewer holds period_lock.override and may unlock this document with a reason. */
  canOverride: boolean;
  periodLabels: string[];
};
