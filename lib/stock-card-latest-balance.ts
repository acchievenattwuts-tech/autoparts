import { db, withDbRetry } from "@/lib/db";

/**
 * Latest running balance per product, straight from the StockCard ledger.
 *
 * Replaces the previous `stockCard.findMany({ distinct: ["productId"] })`
 * pattern: Prisma applies `distinct` in application memory, so every call
 * streamed the products' ENTIRE StockCard history over the wire just to keep
 * one row each — an egress cost that grows with every transaction. Postgres
 * `DISTINCT ON` returns exactly one row per product and walks the existing
 * `[productId, docDate, sorder]` index.
 *
 * Values are the ledger's 4-decimal balances (qtyBalance / priceBalance), the
 * same numbers the reports used before — NOT the 2-decimal `Product.avgCost`.
 */
export type LatestStockBalance = { stock: number; avgCost: number };

export async function getLatestStockBalances(
  productIds: string[],
): Promise<Map<string, LatestStockBalance>> {
  if (productIds.length === 0) {
    return new Map();
  }
  const rows = await withDbRetry(() =>
    db.$queryRaw<Array<{ productId: string; qtyBalance: number; priceBalance: number }>>`
      SELECT DISTINCT ON ("productId")
        "productId",
        "qtyBalance"::float8 AS "qtyBalance",
        "priceBalance"::float8 AS "priceBalance"
      FROM "StockCard"
      WHERE "productId" = ANY(${productIds}::text[])
      ORDER BY "productId", "docDate" DESC, sorder DESC
    `,
  );
  return new Map(
    rows.map((row) => [
      row.productId,
      { stock: Number(row.qtyBalance), avgCost: Number(row.priceBalance) },
    ]),
  );
}
