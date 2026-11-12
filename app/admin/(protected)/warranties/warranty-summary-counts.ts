import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/lib/db";

export type WarrantySummaryCounts = { active: number; soon: number; expired: number; cancelled: number };

export type WarrantySummaryCountsInput = {
  /** Start of today (Thailand). */
  now: Date;
  /** now + 30 Thailand days. */
  soonDate: Date;
  /** The list's startDate range; null = that side is not filtered. */
  startDateFrom: Date | null;
  startDateTo: Date | null;
};

type WarrantySummaryCountsRow = { active: number; soon: number; expired: number; cancelled: number };

/**
 * The four summary cards of the admin warranty list, counted in one row.
 *
 * Same buckets, in the same precedence, as the per-row JS this replaced:
 * CANCELLED first; otherwise endDate < now → expired; otherwise endDate <= soonDate → soon;
 * otherwise active. The startDate range is the one the list applies, and every date goes out
 * as a bound parameter exactly as Prisma sends `startDate: { gte, lte }`.
 */
export const buildWarrantySummaryCountsSql = (input: WarrantySummaryCountsInput): Prisma.Sql => {
  const { now, soonDate, startDateFrom, startDateTo } = input;
  const conditions: Prisma.Sql[] = [];
  if (startDateFrom) conditions.push(Prisma.sql`w."startDate" >= ${startDateFrom}`);
  if (startDateTo) conditions.push(Prisma.sql`w."startDate" <= ${startDateTo}`);
  const whereSql = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
  return Prisma.sql`
    SELECT
      (COUNT(*) FILTER (WHERE w.status <> 'CANCELLED' AND w."endDate" >= ${now} AND w."endDate" > ${soonDate}))::int AS active,
      (COUNT(*) FILTER (WHERE w.status <> 'CANCELLED' AND w."endDate" >= ${now} AND w."endDate" <= ${soonDate}))::int AS soon,
      (COUNT(*) FILTER (WHERE w.status <> 'CANCELLED' AND w."endDate" < ${now}))::int AS expired,
      (COUNT(*) FILTER (WHERE w.status = 'CANCELLED'))::int AS cancelled
    FROM "Warranty" w
    ${whereSql}
  `;
};

export const toWarrantySummaryCounts = (
  rows: readonly WarrantySummaryCountsRow[],
): WarrantySummaryCounts => {
  const row = rows[0];
  return {
    active: Number(row?.active ?? 0),
    soon: Number(row?.soon ?? 0),
    expired: Number(row?.expired ?? 0),
    cancelled: Number(row?.cancelled ?? 0),
  };
};

/**
 * Errors propagate unchanged, as they did when the page loaded every row with
 * `warranty.findMany` and counted them in JS.
 */
export const loadWarrantySummaryCounts = async (
  input: WarrantySummaryCountsInput,
): Promise<WarrantySummaryCounts> => {
  const rows = await db.$queryRaw<WarrantySummaryCountsRow[]>(buildWarrantySummaryCountsSql(input));
  return toWarrantySummaryCounts(rows);
};
