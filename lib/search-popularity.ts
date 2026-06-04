import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma";

/**
 * Phase Q7 — rolling popularity window (days) feeding the search ranking boost.
 */
export const POPULARITY_WINDOW_DAYS = 90;

/**
 * Recompute `product_search_documents.sales_count` = units sold on ACTIVE sales
 * within the rolling window, for every indexed product. Products with no recent
 * sales decay back to 0.
 *
 * Single set-based UPDATE — safe to run on a schedule (Vercel Cron) or manually
 * via `npm run refresh:search-popularity`. The build triggers never touch
 * `sales_count`, so this job is its sole owner.
 */
export async function refreshSearchPopularity(): Promise<{ rowsUpdated: number }> {
  const rowsUpdated = await db.$executeRaw(Prisma.sql`
    UPDATE product_search_documents psd
    SET sales_count = s.qty,
        updated_at = now()
    FROM (
      SELECT
        psd2.product_id,
        COALESCE(SUM(si.quantity), 0)::int AS qty
      FROM product_search_documents psd2
      LEFT JOIN "SaleItem" si ON si."productId" = psd2.product_id
      LEFT JOIN "Sale" sa ON sa.id = si."saleId"
        AND sa.status = 'ACTIVE'
        AND sa."saleDate" >= now() - make_interval(days => ${POPULARITY_WINDOW_DAYS})
      GROUP BY psd2.product_id
    ) s
    WHERE s.product_id = psd.product_id
      AND psd.sales_count IS DISTINCT FROM s.qty
  `);

  return { rowsUpdated };
}
