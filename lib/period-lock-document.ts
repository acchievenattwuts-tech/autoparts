import { db } from "@/lib/db";
import type { DocumentPaymentDocType, Prisma } from "@/lib/generated/prisma";
import { safeNotifyPeriodLockOverride } from "@/lib/notifications";
import {
  assertPeriodsUnlocked,
  buildPeriodLockMessage,
  findLockedPeriods,
  normalizeOverrideReason,
  PERIOD_LOCK_OVERRIDE_PERMISSION,
  type LockedPeriod,
  type PeriodLockOverride,
  type PeriodLockResult,
} from "@/lib/period-lock";
import { PERIOD_LOCK_REASON_FIELD, type PeriodLockView } from "@/lib/period-lock-view";
import { getThailandMonthKey } from "@/lib/th-date";

/**
 * Glue between the month lock (lib/period-lock.ts) and the document actions/pages that
 * honour it: sales, credit notes, expenses, purchases, purchase returns, stock adjustments,
 * balance forward, warranty claims and marketplace settlements.
 *
 * Inside the transaction, after the document's own row locks and before any write:
 *   create / cancel → assertPeriodsUnlocked(tx, [date], override?) straight from lib/period-lock.ts;
 *   update → resolveDocumentPeriodLock(tx, [storedDate, newDate], { override, isNonFinancialOnly }):
 *     kind "non-financial" → write only the allowed text fields (owner decision ก2, plus the line
 *     remarks of P4 via collectLineRemarkUpdates()) and stop — no reason is needed for anyone,
 *     override holder or not (P3);
 *     otherwise the full write runs, and result.overridden means the admin unlocked it (ก1).
 * After an override: add periodLockAuditMeta() to the action's audit entry and call
 * notifyPeriodLockOverrideUsed() after commit. PeriodLockedError maps to its own Thai message.
 */

export const OPEN_PERIOD_RESULT: PeriodLockResult = { locked: [], overridden: false };

export function canOverridePeriodLock(permissions: readonly string[] | null | undefined): boolean {
  return Array.isArray(permissions) && permissions.includes(PERIOD_LOCK_OVERRIDE_PERMISSION);
}

/** The override request an edit/cancel form sent; `allowed` always comes from the session, never the form. */
export function readPeriodLockOverride(
  formData: FormData | null | undefined,
  permissions: readonly string[] | null | undefined,
): PeriodLockOverride {
  const raw = formData?.get(PERIOD_LOCK_REASON_FIELD);
  return { allowed: canOverridePeriodLock(permissions), reason: typeof raw === "string" ? raw : null };
}

export type DocumentPeriodLockDecision =
  | { kind: "open"; result: PeriodLockResult }
  | { kind: "non-financial"; locked: LockedPeriod[] };

/**
 * Update flows. In an open month nothing else runs (no extra reads). In a locked month
 * `isNonFinancialOnly` is asked whether the submitted change touches only the fields the owner
 * allows there (notes, customer display text, delivery info — decision ก2; line remarks — P4); if
 * so the caller must take its narrow write path, and any override reason sent along is ignored
 * (P3: a non-financial edit never needs one). Any other change goes through
 * assertPeriodsUnlocked(), which throws PeriodLockedError unless the override (permission +
 * reason, decision ก1) is valid.
 */
export async function resolveDocumentPeriodLock(
  tx: Prisma.TransactionClient,
  dates: Array<Date | null | undefined>,
  options: {
    override?: PeriodLockOverride;
    isNonFinancialOnly?: () => boolean | Promise<boolean>;
  } = {},
): Promise<DocumentPeriodLockDecision> {
  const locked = await findLockedPeriods(tx, dates);
  if (locked.length === 0) return { kind: "open", result: OPEN_PERIOD_RESULT };
  if (options.isNonFinancialOnly && (await options.isNonFinancialOnly())) return { kind: "non-financial", locked };
  return { kind: "open", result: await assertPeriodsUnlocked(tx, dates, options.override) };
}

// ─── "Non-financial change only" comparisons (owner decision ก2) ─────────────
// Stored Decimal columns and submitted numbers are compared at their stored scale, so a value
// that round-trips through the edit form unchanged is never mistaken for a change.

type NumericLike = number | string | { toString(): string } | null | undefined;

const MONEY_SCALE = 100;
const QUANTITY_SCALE = 10_000;

const toScaled = (value: NumericLike, scale: number): number => Math.round(Number(value ?? 0) * scale);

export const sameMoney = (a: NumericLike, b: NumericLike): boolean => toScaled(a, MONEY_SCALE) === toScaled(b, MONEY_SCALE);

export const sameQuantity = (a: NumericLike, b: NumericLike): boolean =>
  toScaled(a, QUANTITY_SCALE) === toScaled(b, QUANTITY_SCALE);

/** Optional ids/text where null, undefined and "" all mean "none". */
export const sameOptional = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a || null) === (b || null);

export type ComparablePaymentRow = { cashBankAccountId: string; amount: NumericLike };

/** Split payment rows, in order: same accounts and amounts. */
export function samePaymentRows(stored: readonly ComparablePaymentRow[], submitted: readonly ComparablePaymentRow[]): boolean {
  return (
    stored.length === submitted.length &&
    stored.every(
      (row, index) =>
        row.cashBankAccountId === submitted[index].cashBankAccountId && sameMoney(row.amount, submitted[index].amount),
    )
  );
}

// ─── Line remarks (owner decision P4) ────────────────────────────────────────
// Line detail/description text — and a credit-note line's stock-disposition reason — is a remark:
// the per-document comparisons ignore it, and the narrow write path saves it per stored line
// without touching stock, receivables/payables, payments or profit facts.

type RemarkText = string | null | undefined;

export type LineRemarkUpdate<K extends string> = { id: string; data: Partial<Record<K, string | null>> };

/**
 * One update per stored line whose remark text differs from the submitted line at the same
 * position, holding only the changed `fields` ("" and null both mean "none"). Call it only on the
 * non-financial path, where the comparison already matched the lines one to one.
 */
export function collectLineRemarkUpdates<K extends string>(
  stored: ReadonlyArray<{ id: string } & Partial<Record<K, RemarkText>>>,
  submitted: ReadonlyArray<Partial<Record<K, RemarkText>>>,
  fields: readonly K[],
): Array<LineRemarkUpdate<K>> {
  const updates: Array<LineRemarkUpdate<K>> = [];
  stored.forEach((line, index) => {
    const next = submitted[index];
    if (!next) return;
    const data: Partial<Record<K, string | null>> = {};
    for (const field of fields) {
      if (!sameOptional(line[field], next[field])) data[field] = next[field] || null;
    }
    if (Object.keys(data).length > 0) updates.push({ id: line.id, data });
  });
  return updates;
}

/** The document's stored split-payment rows, in order, read with the transaction client. */
export async function loadStoredPaymentRows(
  tx: Prisma.TransactionClient,
  docType: DocumentPaymentDocType,
  docId: string,
): Promise<ComparablePaymentRow[]> {
  try {
    return await tx.documentPayment.findMany({
      where: { docType, docId },
      orderBy: [{ lineNo: "asc" }, { id: "asc" }],
      select: { cashBankAccountId: true, amount: true },
    });
  } catch (error) {
    throw new Error("Failed to load payment rows for the period lock check", { cause: error });
  }
}

export type PeriodLockAuditMeta = { periodLockOverride?: { reason: string; periods: LockedPeriod[] } };

/** Spread into the action's existing audit `meta`; empty unless the lock was overridden. */
export function periodLockAuditMeta(
  result: PeriodLockResult | null | undefined,
  override: PeriodLockOverride | null | undefined,
): PeriodLockAuditMeta {
  const reason = normalizeOverrideReason(override?.reason);
  if (!result?.overridden || !reason) return {};
  return { periodLockOverride: { reason, periods: result.locked } };
}

/** Bell + Telegram alert after commit when the lock was overridden; never throws. */
export async function notifyPeriodLockOverrideUsed(input: {
  result: PeriodLockResult | null | undefined;
  override: PeriodLockOverride | null | undefined;
  entityType: string;
  entityId: string;
  docNo: string;
  action: string;
  actorName: string | null | undefined;
  link: string;
}): Promise<void> {
  const reason = normalizeOverrideReason(input.override?.reason);
  if (!input.result?.overridden || !reason) return;
  await safeNotifyPeriodLockOverride({
    entityType: input.entityType,
    entityId: input.entityId,
    docNo: input.docNo,
    action: input.action,
    periodLabels: input.result.locked.map((period) => period.label),
    reason,
    actorName: input.actorName ?? null,
    link: input.link,
  });
}

const toPeriodLockView = (locked: LockedPeriod[], canOverride: boolean): PeriodLockView | null =>
  locked.length === 0
    ? null
    : {
        message: buildPeriodLockMessage(locked, canOverride),
        canOverride,
        periodLabels: locked.map((period) => period.label),
      };

const isValidDate = (date: Date | null | undefined): date is Date => date instanceof Date && !Number.isNaN(date.getTime());

/**
 * List/detail/edit pages: resolves the lock notice of many documents with ONE query.
 * Read-only preview — every server action re-checks inside its own transaction.
 * The returned function gives null for a document whose months are all open.
 */
export async function getPeriodLockViewResolver(
  dates: Array<Date | null | undefined>,
  permissions: readonly string[] | null | undefined,
): Promise<(...documentDates: Array<Date | null | undefined>) => PeriodLockView | null> {
  const canOverride = canOverridePeriodLock(permissions);
  try {
    const locked = await findLockedPeriods(db, dates);
    if (locked.length === 0) return () => null;
    return (...documentDates) => {
      const keys = new Set(documentDates.filter(isValidDate).map((date) => getThailandMonthKey(date)));
      return toPeriodLockView(locked.filter((period) => keys.has(period.periodKey)), canOverride);
    };
  } catch (error) {
    console.error("[period-lock] page preview failed", error instanceof Error ? error.message : "unknown");
    return () => null;
  }
}

/** One document's lock notice (edit pages), or null when its months are open. */
export async function getDocumentPeriodLockView(
  dates: Array<Date | null | undefined>,
  permissions: readonly string[] | null | undefined,
): Promise<PeriodLockView | null> {
  const resolve = await getPeriodLockViewResolver(dates, permissions);
  return resolve(...dates);
}
