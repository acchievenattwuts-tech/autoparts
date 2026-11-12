import { db } from "@/lib/db";

export type StorefrontVisitorCounts = {
  /** Distinct visitors whose visitDay falls between the month start and today (Thailand date keys). */
  month: number;
  /** Distinct visitors in the whole StorefrontVisitDaily table. */
  total: number;
};

/**
 * Both visitor numbers of the daily dashboard in one statement. They used to be two
 * `findMany({ distinct: ["visitorKey"] })` reads whose `.length` was taken in Node, so every
 * visitor key travelled to the server for a single number. COUNT(DISTINCT) gives the same
 * count: visitorKey is NOT NULL (none is skipped), and visitDay is a `YYYY-MM-DD` text key
 * compared as text with the same bounds Prisma used.
 */
export async function countStorefrontVisitors(
  monthStartKey: string,
  todayKey: string,
): Promise<StorefrontVisitorCounts> {
  try {
    const rows = await db.$queryRaw<Array<{ month: number; total: number }>>`
      SELECT
        COUNT(DISTINCT v."visitorKey") FILTER (
          WHERE v."visitDay" >= ${monthStartKey} AND v."visitDay" <= ${todayKey}
        )::int AS "month",
        COUNT(DISTINCT v."visitorKey")::int AS "total"
      FROM "StorefrontVisitDaily" v
    `;
    return { month: Number(rows[0]?.month ?? 0), total: Number(rows[0]?.total ?? 0) };
  } catch (error) {
    throw new Error("Failed to count storefront visitors", { cause: error });
  }
}
