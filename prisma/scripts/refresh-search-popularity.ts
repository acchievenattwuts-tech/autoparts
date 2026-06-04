/**
 * Phase Q7 — Refresh the rolling 90-day popularity signal used by product
 * search ranking.
 *
 * Writes `sales_count` (units sold on ACTIVE sales in the last 90 days) onto
 * every product_search_documents row. This is intentionally out-of-band from
 * the real-time build triggers: a new sale does NOT refresh the search doc, so
 * popularity is kept fresh by running this job on a schedule. In production it
 * runs via Vercel Cron (see vercel.json → /api/search/cron/refresh-popularity);
 * this script is the manual / local equivalent.
 *
 * Run:  npm run refresh:search-popularity
 */
import { refreshSearchPopularity, POPULARITY_WINDOW_DAYS } from "@/lib/search-popularity";

async function main() {
  const { rowsUpdated } = await refreshSearchPopularity();
  console.log(
    `Search popularity refreshed (window ${POPULARITY_WINDOW_DAYS}d). Rows updated: ${rowsUpdated}`,
  );
}

main()
  .catch((error) => {
    console.error("Search popularity refresh failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void import("@/lib/db").then(({ db }) => db.$disconnect());
  });
