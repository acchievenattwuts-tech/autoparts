import { DocStatus, type Prisma } from "@/lib/generated/prisma";
import { formatDateThai, getThailandDateKey, getThailandMonthKey } from "@/lib/th-date";

/**
 * Owner decision P2 = B (2026-09-30): which date a marketplace settlement's fee / platform income
 * share is booked on.
 *
 * A share follows its sale's date (matching principle) only while that sale's Thailand month was
 * still open when the settlement was recorded. If a ProfitDistribution of that month was IN FORCE
 * at the settlement's createdAt — declared at or before it, and still ACTIVE or cancelled only
 * after it (owner decision S1) — the share is booked on the settlement date instead, so a month
 * whose profit was already distributed never changes.
 *
 * The rule reads only stored timestamps (ProfitDistribution.declaredAt / cancelledAt vs
 * MarketplaceSettlement.createdAt), so every later rebuild — cancel, backfill — gives the same
 * dates as the first one, even after that declaration is cancelled or the month re-declared.
 * createMarketplaceSettlement takes the shared month locks of the sale months before it stamps
 * createdAt, and declaring / cancelling a declaration takes the exclusive one, so a concurrent
 * declaration or cancellation is either visible with an earlier timestamp or waits for the
 * settlement to commit.
 *
 * No server-only imports: the view types are used by the client history table.
 */

/**
 * A ProfitDistribution of one Thailand month ("YYYY-MM"): the ACTIVE one, or a cancelled one that
 * may have been in force when an older settlement was recorded.
 */
export type MonthDistribution = {
  periodKey: string;
  distributionNo: string;
  declaredAt: Date;
  /** When the declaration was cancelled; null or absent while it is ACTIVE. */
  cancelledAt?: Date | null;
};

/** One sale whose settlement shares are booked on the settlement date. */
export type SettlementMovedAmount = {
  docNo: string;
  docDate: Date;
  periodKey: string;
  distributionNo: string;
  feeAmount: number;
  incomeAmount: number;
};

/** Where a settlement's fee / income shares are booked; `moved` lists the non-sale-date ones. */
export type SettlementFactDating = { settlementDate: Date; moved: SettlementMovedAmount[] };

/**
 * Sale-line order of the fee / income split (the satang remainder lands on the last line). The
 * fact builder and the history / detail views must read the lines in this same order.
 */
export const SETTLEMENT_SALE_LINE_ORDER: Prisma.MarketplaceSettlementLineOrderByWithRelationInput[] = [
  { docDate: "asc" },
  { docNo: "asc" },
];

type DistributionReader = Pick<Prisma.TransactionClient, "profitDistribution">;

const toPeriodKey = (year: number, month: number): string => `${year}-${String(month).padStart(2, "0")}`;

/**
 * Every distribution — ACTIVE and cancelled — of the Thailand months of `dates` (one query on the
 * [periodYear, periodMonth, status] index), keyed by distribution number: a month may have several
 * (cancelled declarations and the current one). A cancelled row without cancelledAt cannot be
 * placed in time and is left out.
 */
export async function loadMonthDistributions(
  client: DistributionReader,
  dates: readonly Date[],
): Promise<Map<string, MonthDistribution>> {
  const periodKeys = [...new Set(dates.map((date) => getThailandMonthKey(date)))];
  if (periodKeys.length === 0) return new Map();
  const periods = periodKeys.map((periodKey) => {
    const [periodYear, periodMonth] = periodKey.split("-").map(Number);
    return { periodYear, periodMonth };
  });
  try {
    const rows = await client.profitDistribution.findMany({
      where: { OR: periods, status: { in: [DocStatus.ACTIVE, DocStatus.CANCELLED] } },
      select: {
        periodYear: true,
        periodMonth: true,
        distributionNo: true,
        declaredAt: true,
        status: true,
        cancelledAt: true,
      },
    });
    const distributions = new Map<string, MonthDistribution>();
    for (const row of rows) {
      const active = row.status === DocStatus.ACTIVE;
      if (!active && !row.cancelledAt) continue;
      distributions.set(row.distributionNo, {
        periodKey: toPeriodKey(row.periodYear, row.periodMonth),
        distributionNo: row.distributionNo,
        declaredAt: row.declaredAt,
        cancelledAt: active ? null : row.cancelledAt,
      });
    }
    return distributions;
  } catch (error) {
    throw new Error("Failed to load profit distributions for settlement fee dating", { cause: error });
  }
}

/** S1: declared at or before `at`, and not cancelled by then (still ACTIVE, or cancelled after `at`). */
export function isDistributionInForceAt(distribution: MonthDistribution, at: Date): boolean {
  const time = at.getTime();
  if (distribution.declaredAt.getTime() > time) return false;
  return !distribution.cancelledAt || distribution.cancelledAt.getTime() > time;
}

/**
 * The distribution that had locked `docDate`'s month when the settlement was recorded — the one in
 * force at `recordedAt`, whatever happened to it since — or null when the month was open then.
 */
export function findDistributionLockingAtRecording(
  distributions: ReadonlyMap<string, MonthDistribution>,
  docDate: Date,
  recordedAt: Date,
): MonthDistribution | null {
  const periodKey = getThailandMonthKey(docDate);
  let inForce: MonthDistribution | null = null;
  for (const distribution of distributions.values()) {
    if (distribution.periodKey !== periodKey || !isDistributionInForceAt(distribution, recordedAt)) continue;
    // One declaration per month is ACTIVE at a time; the latest wins should stored times overlap.
    if (!inForce || distribution.declaredAt.getTime() > inForce.declaredAt.getTime()) inForce = distribution;
  }
  return inForce;
}

// ─── Audit metadata ─────────────────────────────────────────

export type SettlementFactDatingAudit = {
  rule: string;
  settlementDate: string;
  movedToSettlementDate: Array<{
    saleNo: string;
    saleDate: string;
    periodKey: string;
    distributionNo: string;
    feeAmount: number;
    incomeAmount: number;
  }>;
};

const FACT_DATING_AUDIT_RULE =
  "P2=B: shares of a sale month already distributed when the settlement was recorded are booked on the settlement date";

/** Audit `meta` entry for a recorded settlement; null when the fact builder reported nothing. */
export function toSettlementFactDatingAudit(
  dating: SettlementFactDating | null | undefined,
): SettlementFactDatingAudit | null {
  if (!dating) return null;
  return {
    rule: FACT_DATING_AUDIT_RULE,
    settlementDate: getThailandDateKey(dating.settlementDate),
    movedToSettlementDate: dating.moved.map((row) => ({
      saleNo: row.docNo,
      saleDate: getThailandDateKey(row.docDate),
      periodKey: row.periodKey,
      distributionNo: row.distributionNo,
      feeAmount: row.feeAmount,
      incomeAmount: row.incomeAmount,
    })),
  };
}

// ─── History / detail view ─────────────────────────────────

export type SettlementFeeDatingMonthView = {
  periodKey: string;
  periodLabel: string;
  distributionNo: string;
  docNos: string[];
  feeAmount: number;
  incomeAmount: number;
};

/** Serializable (client-safe) summary of the shares booked on the settlement date. */
export type SettlementFeeDatingView = {
  settlementDateLabel: string;
  feeAmount: number;
  incomeAmount: number;
  months: SettlementFeeDatingMonthView[];
};

const MONTH_LABEL_OPTIONS: Intl.DateTimeFormatOptions = { day: undefined, month: "long", year: "numeric" };

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** Groups the moved shares by sale month for the settlement history and detail pages. */
export function toSettlementFeeDatingView(
  dating: SettlementFactDating | null | undefined,
): SettlementFeeDatingView | null {
  if (!dating || dating.moved.length === 0) return null;
  const months = new Map<string, SettlementFeeDatingMonthView>();
  for (const row of dating.moved) {
    const month = months.get(row.periodKey) ?? {
      periodKey: row.periodKey,
      periodLabel: formatDateThai(row.docDate, MONTH_LABEL_OPTIONS),
      distributionNo: row.distributionNo,
      docNos: [],
      feeAmount: 0,
      incomeAmount: 0,
    };
    month.docNos.push(row.docNo);
    month.feeAmount = roundMoney(month.feeAmount + row.feeAmount);
    month.incomeAmount = roundMoney(month.incomeAmount + row.incomeAmount);
    months.set(row.periodKey, month);
  }
  const monthViews = [...months.values()].sort((a, b) => a.periodKey.localeCompare(b.periodKey));
  return {
    settlementDateLabel: formatDateThai(dating.settlementDate),
    feeAmount: roundMoney(monthViews.reduce((sum, month) => sum + month.feeAmount, 0)),
    incomeAmount: roundMoney(monthViews.reduce((sum, month) => sum + month.incomeAmount, 0)),
    months: monthViews,
  };
}
