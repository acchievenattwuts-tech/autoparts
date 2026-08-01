import { db } from "@/lib/db";
import { DocStatus } from "@/lib/generated/prisma";
import { aggregateProfitSummary, type ProfitSummary } from "@/lib/profit-dashboard";
import { getThailandMonthKey, parseDateOnlyToEndOfDay, parseDateOnlyToStartOfDay } from "@/lib/th-date";

/**
 * Domain layer for แบ่งกำไรผู้ร่วมทุน (partner profit distribution).
 *
 * DESIGN RULE — this module must never create an Expense and never write to
 * FactProfit. Distributing profit to the owners is an appropriation of profit,
 * not a business cost. Keeping it out of FactProfit is what makes back-keying
 * safe: declaring July's distribution on 1 August leaves August's net profit
 * completely untouched. Only cash moves, and it moves on the real transfer date.
 */

export const THAI_MONTH_LABELS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
] as const;

export const THAI_MONTH_SHORT_LABELS = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
] as const;

/** How far back carry-forward will look for undeclared or restated months. */
const CARRY_FORWARD_MAX_LOOKBACK_MONTHS = 36;
/** How many closed months are offered in the period picker. */
const SELECTABLE_PERIOD_MONTHS = 24;
/** A partner allocation split must land on 100% within this tolerance. */
export const SHARE_PERCENT_TOLERANCE = 0.01;
/** Rounding tolerance when validating that allocated amounts sum to the total. */
export const AMOUNT_TOLERANCE = 0.05;

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function getPeriodBounds(year: number, month: number): { start: Date; end: Date } {
  const mm = String(month).padStart(2, "0");
  const lastDay = String(getDaysInMonth(year, month)).padStart(2, "0");
  return {
    start: parseDateOnlyToStartOfDay(`${year}-${mm}-01`),
    end: parseDateOnlyToEndOfDay(`${year}-${mm}-${lastDay}`),
  };
}

export function getPeriodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function formatPeriodLabel(year: number, month: number): string {
  return `${THAI_MONTH_LABELS[month - 1]} ${year}`;
}

export function formatPeriodShortLabel(month: number): string {
  return THAI_MONTH_SHORT_LABELS[month - 1];
}

/** Current year/month in Thailand time. */
export function getCurrentPeriod(): { year: number; month: number } {
  const [year, month] = getThailandMonthKey().split("-");
  return { year: Number(year), month: Number(month) };
}

function shiftPeriod(
  year: number,
  month: number,
  offsetMonths: number,
): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + offsetMonths;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

function comparePeriods(
  left: { year: number; month: number },
  right: { year: number; month: number },
): number {
  if (left.year !== right.year) return left.year - right.year;
  return left.month - right.month;
}

/** True when the whole month has already ended in Thailand time. */
export function isClosedPeriod(year: number, month: number): boolean {
  return comparePeriods({ year, month }, getCurrentPeriod()) < 0;
}

/**
 * The partners only started sharing profit from July 2026. Anything before that
 * period is out of scope everywhere: it cannot be declared, it is not counted in
 * the yearly totals, and it never carries forward. The ~131k of losses booked in
 * May–June 2026 predate the arrangement and are deliberately written off.
 *
 * Months before this period are still *displayed* (greyed out) so the history
 * stays visible — they are simply excluded from every calculation.
 */
export const PROFIT_DISTRIBUTION_START_PERIOD = { year: 2026, month: 7 } as const;

export const PROFIT_DISTRIBUTION_START_LABEL = formatPeriodLabel(
  PROFIT_DISTRIBUTION_START_PERIOD.year,
  PROFIT_DISTRIBUTION_START_PERIOD.month,
);

export function isBeforeStartPeriod(year: number, month: number): boolean {
  return comparePeriods({ year, month }, PROFIT_DISTRIBUTION_START_PERIOD) < 0;
}

export type PeriodOption = {
  year: number;
  month: number;
  periodKey: string;
  label: string;
  hasActiveDistribution: boolean;
};

/**
 * Closed months available for declaration, newest first. A month that already
 * carries an ACTIVE distribution is still listed but flagged, so the UI can
 * explain why it cannot be picked instead of silently hiding it.
 */
export async function listSelectablePeriods(): Promise<PeriodOption[]> {
  const current = getCurrentPeriod();
  const periods: Array<{ year: number; month: number }> = [];
  for (let offset = 1; offset <= SELECTABLE_PERIOD_MONTHS; offset += 1) {
    const period = shiftPeriod(current.year, current.month, -offset);
    if (isBeforeStartPeriod(period.year, period.month)) break;
    periods.push(period);
  }

  const activeKeys = new Set(
    (
      await db.profitDistribution.findMany({
        where: { status: DocStatus.ACTIVE },
        select: { activePeriodKey: true },
      })
    )
      .map((row) => row.activePeriodKey)
      .filter((key): key is string => typeof key === "string"),
  );

  return periods.map((period) => {
    const periodKey = getPeriodKey(period.year, period.month);
    return {
      year: period.year,
      month: period.month,
      periodKey,
      label: formatPeriodLabel(period.year, period.month),
      hasActiveDistribution: activeKeys.has(periodKey),
    };
  });
}

/** Net profit figures for one calendar month, straight from FactProfit. */
export async function getPeriodProfitSummary(
  year: number,
  month: number,
): Promise<ProfitSummary> {
  const { start, end } = getPeriodBounds(year, month);
  return aggregateProfitSummary(start, end);
}

export type CarryForwardBreakdownRow = {
  year: number;
  month: number;
  label: string;
  /** "UNDECLARED" — never distributed; "RESTATED" — distributed then recomputed. */
  kind: "UNDECLARED" | "RESTATED";
  amount: number;
};

export type CarryForwardResult = {
  amount: number;
  rows: CarryForwardBreakdownRow[];
};

/**
 * Amount carried into a period from earlier months. Two disjoint sources:
 *
 *  1. UNDECLARED — a closed month with no ACTIVE distribution (a loss month, or
 *     one that was skipped or cancelled). Its whole net profit rolls forward,
 *     so a loss reduces what the next month may distribute.
 *  2. RESTATED — a month that WAS distributed but whose net profit has since
 *     changed, because FactProfit is rebuilt when a source document is edited
 *     or cancelled. The difference against the stored snapshot rolls forward
 *     instead of rewriting the closed document.
 *
 * Nothing is carried until the very first distribution exists — the shop starts
 * with no opening balances, so earlier history is deliberately ignored.
 */
export async function computeCarryForward(
  year: number,
  month: number,
): Promise<CarryForwardResult> {
  const target = { year, month };
  if (isBeforeStartPeriod(target.year, target.month)) return { amount: 0, rows: [] };

  const earliest = await db.profitDistribution.findFirst({
    where: { status: DocStatus.ACTIVE },
    orderBy: [{ periodYear: "asc" }, { periodMonth: "asc" }],
    select: { periodYear: true, periodMonth: true },
  });
  if (!earliest) return { amount: 0, rows: [] };

  const oldestAllowed = shiftPeriod(
    target.year,
    target.month,
    -CARRY_FORWARD_MAX_LOOKBACK_MONTHS,
  );
  // Hard floor: never look before the month the arrangement started, whatever
  // the lookback window or the first document would otherwise allow.
  const lookbackFloor =
    comparePeriods(oldestAllowed, PROFIT_DISTRIBUTION_START_PERIOD) > 0
      ? oldestAllowed
      : PROFIT_DISTRIBUTION_START_PERIOD;
  const startPeriod =
    comparePeriods({ year: earliest.periodYear, month: earliest.periodMonth }, lookbackFloor) > 0
      ? { year: earliest.periodYear, month: earliest.periodMonth }
      : lookbackFloor;

  const periods: Array<{ year: number; month: number }> = [];
  let cursor = startPeriod;
  while (comparePeriods(cursor, target) < 0) {
    periods.push(cursor);
    cursor = shiftPeriod(cursor.year, cursor.month, 1);
  }
  if (periods.length === 0) return { amount: 0, rows: [] };

  const activeDistributions = await db.profitDistribution.findMany({
    where: {
      status: DocStatus.ACTIVE,
      OR: periods.map((period) => ({
        periodYear: period.year,
        periodMonth: period.month,
      })),
    },
    select: { periodYear: true, periodMonth: true, snapshotNetProfit: true },
  });
  const snapshotByPeriod = new Map(
    activeDistributions.map((row) => [
      getPeriodKey(row.periodYear, row.periodMonth),
      Number(row.snapshotNetProfit),
    ]),
  );

  const summaries = await Promise.all(
    periods.map((period) => getPeriodProfitSummary(period.year, period.month)),
  );

  const rows: CarryForwardBreakdownRow[] = [];
  periods.forEach((period, index) => {
    const currentNetProfit = roundMoney(summaries[index].netProfitAmount);
    const periodKey = getPeriodKey(period.year, period.month);
    const snapshot = snapshotByPeriod.get(periodKey);

    if (snapshot === undefined) {
      if (Math.abs(currentNetProfit) < 0.005) return;
      rows.push({
        year: period.year,
        month: period.month,
        label: formatPeriodLabel(period.year, period.month),
        kind: "UNDECLARED",
        amount: currentNetProfit,
      });
      return;
    }

    const difference = roundMoney(currentNetProfit - snapshot);
    if (Math.abs(difference) < 0.005) return;
    rows.push({
      year: period.year,
      month: period.month,
      label: formatPeriodLabel(period.year, period.month),
      kind: "RESTATED",
      amount: difference,
    });
  });

  const amount = roundMoney(rows.reduce((sum, row) => sum + row.amount, 0));
  return { amount, rows };
}

export type PartnerOption = {
  partnerProfileId: string;
  userId: string;
  name: string;
  defaultSharePercent: number;
  bankLabel: string | null;
};

export async function listActivePartners(): Promise<PartnerOption[]> {
  const partners = await db.partnerProfile.findMany({
    where: { isActive: true, user: { isActive: true } },
    orderBy: [{ defaultSharePercent: "desc" }, { joinedAt: "asc" }],
    select: {
      id: true,
      userId: true,
      defaultSharePercent: true,
      bankName: true,
      bankAccountNo: true,
      user: { select: { name: true } },
    },
  });

  return partners.map((partner) => {
    // Shown in full — the account numbers belong to the four owners themselves,
    // and they need to read them when transferring money.
    const bankLabel = [partner.bankName, partner.bankAccountNo]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join(" ");

    return {
      partnerProfileId: partner.id,
      userId: partner.userId,
      name: partner.user.name,
      defaultSharePercent: Number(partner.defaultSharePercent),
      bankLabel: bankLabel || null,
    };
  });
}

export type CashHealth = {
  cashBankBalance: number;
  arOutstanding: number;
  stockValue: number;
};

/**
 * Context shown before confirming a payout: accounting profit is not cash.
 * Most of it is usually tied up in stock and receivables, so distributing the
 * full net profit every month can drain the shop while the P&L still looks good.
 */
export async function getCashHealth(): Promise<CashHealth> {
  const [accounts, receivable, stockValueRows] = await Promise.all([
    db.cashBankAccount.findMany({
      where: { isActive: true },
      select: { id: true, openingBalance: true },
    }),
    db.sale.aggregate({
      _sum: { amountRemain: true },
      where: { status: DocStatus.ACTIVE, amountRemain: { gt: 0 } },
    }),
    db.$queryRaw<Array<{ value: number }>>`
      SELECT COALESCE(SUM(p.stock * p."avgCost"), 0)::float8 AS value
      FROM "Product" p
      WHERE p.stock > 0
    `,
  ]);

  const latestMovements = await Promise.all(
    accounts.map((account) =>
      db.cashBankMovement.findFirst({
        where: { accountId: account.id },
        orderBy: [
          { txnDate: "desc" },
          { sorder: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
        select: { balanceAfter: true },
      }),
    ),
  );

  const cashBankBalance = accounts.reduce((sum, account, index) => {
    const latest = latestMovements[index];
    return sum + Number(latest?.balanceAfter ?? account.openingBalance);
  }, 0);

  return {
    cashBankBalance: roundMoney(cashBankBalance),
    arOutstanding: roundMoney(Number(receivable._sum.amountRemain ?? 0)),
    stockValue: roundMoney(stockValueRows[0]?.value ?? 0),
  };
}

export type DistributionPreview = {
  year: number;
  month: number;
  periodKey: string;
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
  summary: ProfitSummary;
  carryForward: CarryForwardResult;
  /** netProfit + carryForward — the ceiling of what may be distributed. */
  distributableBase: number;
  partners: PartnerOption[];
  cashHealth: CashHealth;
  hasActiveDistribution: boolean;
};

export async function buildDistributionPreview(
  year: number,
  month: number,
): Promise<DistributionPreview> {
  const { start, end } = getPeriodBounds(year, month);
  const periodKey = getPeriodKey(year, month);

  const [summary, carryForward, partners, cashHealth, existing] = await Promise.all([
    getPeriodProfitSummary(year, month),
    computeCarryForward(year, month),
    listActivePartners(),
    getCashHealth(),
    db.profitDistribution.findUnique({
      where: { activePeriodKey: periodKey },
      select: { id: true },
    }),
  ]);

  return {
    year,
    month,
    periodKey,
    periodLabel: formatPeriodLabel(year, month),
    periodStart: start,
    periodEnd: end,
    summary,
    carryForward,
    distributableBase: roundMoney(summary.netProfitAmount + carryForward.amount),
    partners,
    cashHealth,
    hasActiveDistribution: Boolean(existing),
  };
}

export type YearOverviewPartnerShare = {
  partnerProfileId: string;
  partnerUserId: string;
  partnerName: string;
  sharePercent: number;
  shareAmount: number;
};

export type YearOverviewMonth = {
  year: number;
  month: number;
  label: string;
  shortLabel: string;
  /** Net profit as the system computes it *today* (may differ from a snapshot). */
  currentNetProfit: number;
  isClosed: boolean;
  /** Predates the profit-sharing arrangement — shown, but never counted. */
  isBeforeStart: boolean;
  distribution: {
    id: string;
    distributionNo: string;
    payDate: Date;
    snapshotNetProfit: number;
    carryForwardAmount: number;
    distributedAmount: number;
    retainedAmount: number;
    shares: YearOverviewPartnerShare[];
  } | null;
};

export type YearOverview = {
  year: number;
  months: YearOverviewMonth[];
  totals: {
    currentNetProfit: number;
    distributedAmount: number;
    retainedAmount: number;
  };
  pendingClosedMonths: number;
};

/**
 * One row per month of the selected year: what the shop earned, what was
 * distributed, and which closed months are still awaiting a declaration.
 */
export async function getYearOverview(year: number): Promise<YearOverview> {
  const months = Array.from({ length: 12 }, (_, index) => index + 1);

  const [summaries, distributions] = await Promise.all([
    Promise.all(months.map((month) => getPeriodProfitSummary(year, month))),
    db.profitDistribution.findMany({
      where: { periodYear: year, status: DocStatus.ACTIVE },
      orderBy: { periodMonth: "asc" },
      select: {
        id: true,
        distributionNo: true,
        periodMonth: true,
        payDate: true,
        snapshotNetProfit: true,
        carryForwardAmount: true,
        distributedAmount: true,
        retainedAmount: true,
        items: {
          orderBy: { lineNo: "asc" },
          select: {
            partnerProfileId: true,
            partnerUserId: true,
            partnerName: true,
            sharePercent: true,
            shareAmount: true,
          },
        },
      },
    }),
  ]);

  const distributionByMonth = new Map(
    distributions.map((distribution) => [distribution.periodMonth, distribution]),
  );

  const rows: YearOverviewMonth[] = months.map((month, index) => {
    const distribution = distributionByMonth.get(month);
    return {
      year,
      month,
      label: formatPeriodLabel(year, month),
      shortLabel: formatPeriodShortLabel(month),
      currentNetProfit: roundMoney(summaries[index].netProfitAmount),
      isClosed: isClosedPeriod(year, month),
      isBeforeStart: isBeforeStartPeriod(year, month),
      distribution: distribution
        ? {
            id: distribution.id,
            distributionNo: distribution.distributionNo,
            payDate: distribution.payDate,
            snapshotNetProfit: Number(distribution.snapshotNetProfit),
            carryForwardAmount: Number(distribution.carryForwardAmount),
            distributedAmount: Number(distribution.distributedAmount),
            retainedAmount: Number(distribution.retainedAmount),
            shares: distribution.items.map((item) => ({
              partnerProfileId: item.partnerProfileId,
              partnerUserId: item.partnerUserId,
              partnerName: item.partnerName,
              sharePercent: Number(item.sharePercent),
              shareAmount: Number(item.shareAmount),
            })),
          }
        : null,
    };
  });

  return {
    year,
    months: rows,
    totals: {
      // Months before the arrangement started never enter any total.
      currentNetProfit: roundMoney(
        rows.reduce(
          (sum, row) => sum + (row.isClosed && !row.isBeforeStart ? row.currentNetProfit : 0),
          0,
        ),
      ),
      distributedAmount: roundMoney(
        rows.reduce((sum, row) => sum + (row.distribution?.distributedAmount ?? 0), 0),
      ),
      retainedAmount: roundMoney(
        rows.reduce((sum, row) => sum + (row.distribution?.retainedAmount ?? 0), 0),
      ),
    },
    // Only a closed, in-scope month that actually made a profit needs declaring.
    pendingClosedMonths: rows.filter(
      (row) =>
        row.isClosed && !row.isBeforeStart && !row.distribution && row.currentNetProfit > 0,
    ).length,
  };
}

export type PartnerYearSummary = {
  partnerProfileId: string;
  userId: string;
  name: string;
  defaultSharePercent: number;
  /** Received in the most recent declared month of this year. */
  latestAmount: number;
  yearTotal: number;
  /** Share of the year's distributed total actually received. */
  actualSharePercent: number;
  /** actualSharePercent − defaultSharePercent, in percentage points. */
  fairnessDeltaPercent: number;
  capitalBalance: number;
};

/**
 * Per-partner cards. `fairnessDeltaPercent` is the number that matters when the
 * split is adjusted month by month: it shows who has drifted away from the
 * agreed baseline once the whole year is taken together.
 */
export async function getPartnerYearSummaries(year: number): Promise<PartnerYearSummary[]> {
  const partners = await listActivePartners();
  if (partners.length === 0) return [];

  const partnerIds = partners.map((partner) => partner.partnerProfileId);

  const [items, latestDistribution, ledgerBalances] = await Promise.all([
    db.profitDistributionItem.findMany({
      where: {
        partnerProfileId: { in: partnerIds },
        distribution: { periodYear: year, status: DocStatus.ACTIVE },
      },
      select: {
        partnerProfileId: true,
        shareAmount: true,
        distribution: { select: { periodMonth: true } },
      },
    }),
    db.profitDistribution.findFirst({
      where: { periodYear: year, status: DocStatus.ACTIVE },
      orderBy: { periodMonth: "desc" },
      select: { periodMonth: true },
    }),
    Promise.all(
      partnerIds.map((partnerProfileId) =>
        db.partnerLedger.findFirst({
          where: { partnerProfileId },
          orderBy: [
            { entryDate: "desc" },
            { sorder: "desc" },
            { createdAt: "desc" },
            { id: "desc" },
          ],
          select: { balanceAfter: true },
        }),
      ),
    ),
  ]);

  const yearTotalByPartner = new Map<string, number>();
  const latestByPartner = new Map<string, number>();
  for (const item of items) {
    const amount = Number(item.shareAmount);
    yearTotalByPartner.set(
      item.partnerProfileId,
      (yearTotalByPartner.get(item.partnerProfileId) ?? 0) + amount,
    );
    if (latestDistribution && item.distribution.periodMonth === latestDistribution.periodMonth) {
      latestByPartner.set(
        item.partnerProfileId,
        (latestByPartner.get(item.partnerProfileId) ?? 0) + amount,
      );
    }
  }

  const distributedTotal = [...yearTotalByPartner.values()].reduce((sum, value) => sum + value, 0);

  return partners.map((partner, index) => {
    const yearTotal = roundMoney(yearTotalByPartner.get(partner.partnerProfileId) ?? 0);
    const actualSharePercent =
      distributedTotal > 0 ? roundMoney((yearTotal / distributedTotal) * 100) : 0;

    return {
      partnerProfileId: partner.partnerProfileId,
      userId: partner.userId,
      name: partner.name,
      defaultSharePercent: partner.defaultSharePercent,
      latestAmount: roundMoney(latestByPartner.get(partner.partnerProfileId) ?? 0),
      yearTotal,
      actualSharePercent,
      fairnessDeltaPercent:
        distributedTotal > 0
          ? roundMoney(actualSharePercent - partner.defaultSharePercent)
          : 0,
      capitalBalance: roundMoney(Number(ledgerBalances[index]?.balanceAfter ?? 0)),
    };
  });
}

/** Years that already have data, newest first — drives the year picker. */
export async function listDistributionYears(): Promise<number[]> {
  const rows = await db.profitDistribution.findMany({
    where: { status: DocStatus.ACTIVE },
    distinct: ["periodYear"],
    orderBy: { periodYear: "desc" },
    select: { periodYear: true },
  });

  const years = new Set(rows.map((row) => row.periodYear));
  years.add(getCurrentPeriod().year);
  return [...years].sort((left, right) => right - left);
}
