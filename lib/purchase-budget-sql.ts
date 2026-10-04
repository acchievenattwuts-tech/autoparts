import { Prisma } from "@/lib/generated/prisma";

/**
 * SQL building blocks of the purchase budget, shared by the totals (lib/purchase-budget.ts) and the
 * ledger (lib/purchase-budget-ledger.ts) so both always count the same documents the same way.
 * Every window is [from, to) on the document date; `to` null = no upper bound.
 */

const upperBound = (column: Prisma.Sql, to: Date | null): Prisma.Sql =>
  to ? Prisma.sql`AND ${column} < ${to}` : Prisma.empty;

/** Thailand calendar date (YYYY-MM-DD) of a timestamptz expression. */
export const thaiDateKeySql = (column: Prisma.Sql): Prisma.Sql =>
  Prisma.sql`to_char(timezone('Asia/Bangkok', ${column}), 'YYYY-MM-DD')`;

/**
 * Value a purchase put into stock (alias `pu`): the pre-VAT amount when its input VAT is recoverable
 * (lib/input-vat.ts: VAT type ≠ NO_VAT, rate > 0, tax-invoice date on/after `vat_registered_from`),
 * else the net amount — the same cost base lib/purchase-inventory-cost.ts spreads over the lines.
 */
export function purchaseCostSql(registeredFromKey: string | null): Prisma.Sql {
  const recoverable = registeredFromKey
    ? Prisma.sql`(pu."vatType" <> 'NO_VAT' AND pu."vatRate" > 0 AND pu."taxInvoiceDate" IS NOT NULL
        AND ${thaiDateKeySql(Prisma.sql`pu."taxInvoiceDate"`)} >= ${registeredFromKey})`
    : Prisma.sql`FALSE`;
  return Prisma.sql`(CASE WHEN ${recoverable} THEN pu."subtotalAmount" ELSE pu."netAmount" END)`;
}

/** ACTIVE purchases dated in the window, one row each: id, docNo, docDate, supplierId, cost. */
export function purchaseRowsSql(registeredFromKey: string | null, from: Date, to: Date | null): Prisma.Sql {
  return Prisma.sql`
    SELECT pu."id", pu."purchaseNo" AS "docNo", pu."purchaseDate" AS "docDate", pu."supplierId",
           ${purchaseCostSql(registeredFromKey)} AS "cost"
    FROM "Purchase" pu
    WHERE pu."status" = 'ACTIVE' AND pu."purchaseDate" >= ${from} ${upperBound(Prisma.sql`pu."purchaseDate"`, to)}`;
}

/** ACTIVE sales dated in the window, one row each, with the cost snapshot of their lines. */
export function saleRowsSql(from: Date, to: Date | null): Prisma.Sql {
  return Prisma.sql`
    SELECT s."id", s."saleNo" AS "docNo", s."saleDate" AS "docDate", s."customerId", s."customerName",
           (SELECT COALESCE(SUM(si."quantity" * si."costPrice"), 0) FROM "SaleItem" si WHERE si."saleId" = s."id") AS "cost"
    FROM "Sale" s
    WHERE s."status" = 'ACTIVE' AND s."saleDate" >= ${from} ${upperBound(Prisma.sql`s."saleDate"`, to)}`;
}

/**
 * Stock-card rows of every other stock move dated in the window (purchases and sales are counted from
 * their own documents; balance-forward entries are not purchases). One index range scan per product
 * on [productId, docDate, sorder] (.rules §7). `stockValue` is the row's effect on stock at cost.
 * `OFFSET 0` keeps the planner from flattening the lateral into one pass over every stock-card row,
 * so the cost follows the product count and the window, not the stock-card history.
 */
export function stockOtherRowsSql(from: Date, to: Date | null): Prisma.Sql {
  return Prisma.sql`
    SELECT x."docNo", x."source", x."docDate",
           (x."qtyIn" * x."priceIn" + x."landedCost" + x."valueAdjustment" - x."qtyOut" * x."priceOut") AS "stockValue"
    FROM "Product" p
    CROSS JOIN LATERAL (
      SELECT sc."docNo", sc."source", sc."docDate", sc."qtyIn", sc."priceIn", sc."landedCost",
             sc."valueAdjustment", sc."qtyOut", sc."priceOut"
      FROM "StockCard" sc
      WHERE sc."productId" = p."id" AND sc."docDate" >= ${from} ${upperBound(Prisma.sql`sc."docDate"`, to)}
        AND sc."source" NOT IN ('PURCHASE', 'SALE', 'BF')
      OFFSET 0
    ) x`;
}
