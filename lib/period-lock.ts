import { Prisma } from "@/lib/generated/prisma";
import { formatDateThai, getThailandMonthKey } from "@/lib/th-date";

/**
 * Month lock tied to profit distribution (owner decision 2026-09-30, review T2 / ก1).
 *
 * A Thailand calendar month with an ACTIVE ProfitDistribution is "locked": documents dated in
 * that month that affect profit or stock cannot be created, changed or cancelled. Corrections are
 * keyed as new documents dated today. An admin holding PERIOD_LOCK_OVERRIDE_PERMISSION may still
 * change one document by giving a reason; the caller must audit that reason and alert Telegram.
 * The existing carry-forward (lib/profit-distribution.ts) then rolls any restated difference into
 * the next declaration.
 *
 * Document checks take a SHARED advisory lock per month and the declare action takes the
 * EXCLUSIVE one (lockPeriodForDeclaration), so a declaration cannot slip in between a document's
 * check and its commit.
 */

export const PERIOD_LOCK_OVERRIDE_PERMISSION = "period_lock.override";
const PERIOD_LOCK_KEY_PREFIX = "period-lock:";
const MIN_OVERRIDE_REASON_LENGTH = 5;

export type LockedPeriod = { periodKey: string; distributionNo: string; label: string };

export type PeriodLockOverride = { allowed: boolean; reason: string | null | undefined };

export type PeriodLockResult = { locked: LockedPeriod[]; overridden: boolean };

export class PeriodLockedError extends Error {
  readonly periods: LockedPeriod[];

  constructor(message: string, periods: LockedPeriod[]) {
    super(message);
    this.name = "PeriodLockedError";
    this.periods = periods;
  }
}

const toPeriodKeys = (dates: Array<Date | null | undefined>): string[] =>
  [...new Set(dates.filter((date): date is Date => date instanceof Date && !Number.isNaN(date.getTime()))
    .map((date) => getThailandMonthKey(date)))].sort();

const formatPeriodLabel = (periodKey: string): string => {
  const [year, month] = periodKey.split("-").map(Number);
  return formatDateThai(new Date(Date.UTC(year, month - 1, 15)), { day: undefined, month: "long", year: "numeric" });
};

/** Exclusive lock for the declare/cancel-declaration actions of one period ("YYYY-MM"). */
export async function lockPeriodForDeclaration(tx: Prisma.TransactionClient, periodKey: string): Promise<void> {
  try {
    // $executeRaw, not $queryRaw: pg_advisory_xact_lock() returns void (see lib/doc-number.ts).
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${PERIOD_LOCK_KEY_PREFIX + periodKey}))`);
  } catch (error) {
    throw new Error("Failed to lock profit distribution period", { cause: error });
  }
}

/** Declared (locked) months among the Thailand months of `dates`, holding shared locks until commit. */
export async function findLockedPeriods(
  tx: Prisma.TransactionClient,
  dates: Array<Date | null | undefined>,
): Promise<LockedPeriod[]> {
  try {
    const periodKeys = toPeriodKeys(dates);
    if (periodKeys.length === 0) return [];
    for (const periodKey of periodKeys) {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock_shared(hashtext(${PERIOD_LOCK_KEY_PREFIX + periodKey}))`);
    }
    const declared = await tx.profitDistribution.findMany({
      where: { activePeriodKey: { in: periodKeys }, status: "ACTIVE" },
      select: { activePeriodKey: true, distributionNo: true },
    });
    return declared
      .filter((row): row is { activePeriodKey: string; distributionNo: string } => row.activePeriodKey !== null)
      .map((row) => ({ periodKey: row.activePeriodKey, distributionNo: row.distributionNo, label: formatPeriodLabel(row.activePeriodKey) }))
      .sort((a, b) => a.periodKey.localeCompare(b.periodKey));
  } catch (error) {
    throw new Error("Failed to check locked profit distribution periods", { cause: error });
  }
}

/** Thai message shared by server rejections and UI notices. */
export function buildPeriodLockMessage(periods: LockedPeriod[], canOverride = false): string {
  const months = periods.map((period) => `${period.label} (${period.distributionNo})`).join(", ");
  const base = `เอกสารนี้อยู่ในเดือนที่ประกาศปันผลแล้ว: ${months} จึงแก้ไขหรือยกเลิกตัวเลขไม่ได้ ` +
    "ให้คีย์เอกสารแก้ไขลงวันที่ปัจจุบันแทน";
  return canOverride ? `${base} หรือระบุเหตุผลเพื่อปลดล็อกเฉพาะเอกสารนี้` : base;
}

export function normalizeOverrideReason(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim() ?? "";
  return trimmed.length >= MIN_OVERRIDE_REASON_LENGTH ? trimmed : null;
}

/**
 * Throws PeriodLockedError when any of `dates` falls in a declared month, unless an allowed
 * override with a reason is supplied. Returns `overridden: true` so the caller writes the audit
 * entry (with the reason) and sends the Telegram alert.
 */
export async function assertPeriodsUnlocked(
  tx: Prisma.TransactionClient,
  dates: Array<Date | null | undefined>,
  override?: PeriodLockOverride,
): Promise<PeriodLockResult> {
  const locked = await findLockedPeriods(tx, dates);
  if (locked.length === 0) return { locked, overridden: false };
  if (override?.allowed && normalizeOverrideReason(override.reason)) return { locked, overridden: true };
  const message = override?.allowed && !normalizeOverrideReason(override.reason)
    ? `${buildPeriodLockMessage(locked, true)} (เหตุผลต้องยาวอย่างน้อย ${MIN_OVERRIDE_REASON_LENGTH} ตัวอักษร)`
    : buildPeriodLockMessage(locked, override?.allowed ?? false);
  throw new PeriodLockedError(message, locked);
}
