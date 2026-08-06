import { cache } from "react";

import { buildLineDailySummary } from "@/lib/line-daily-summary";

/**
 * Request-scoped loader for the daily summary.
 *
 * The stat cards and the Flex preview live behind separate Suspense
 * boundaries but need the same summary, so `cache()` keeps it to one
 * computation per request instead of two.
 */
export const getLineDailySummaryForDay = cache(
  async (reportDayKey: string, compactMode: boolean) =>
    buildLineDailySummary(reportDayKey, { compactMode }),
);
