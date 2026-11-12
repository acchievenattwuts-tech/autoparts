import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/lib/db";

/** The search card shows at most this many aliases per product, the first ones by alias id. */
export const PRODUCT_CARD_ALIAS_LIMIT = 4;

export type ProductCardAlias = { alias: string };

export type ProductCardAliasRow = { productId: string; alias: string };

/**
 * First {@link PRODUCT_CARD_ALIAS_LIMIT} aliases of each product, ordered by alias id.
 *
 * Replaces the nested `aliases: { orderBy: { id: "asc" }, take: 4 }` select: Prisma
 * sends that as `productId IN (...)` with no LIMIT and slices each product's rows in
 * memory, so every render streamed every alias of the 20 products on the page. The
 * lateral subquery returns the same rows (same column order, same `ORDER BY id`, same
 * cut-off) without the rest.
 */
export const buildProductCardAliasesSql = (productIds: readonly string[]): Prisma.Sql => Prisma.sql`
  SELECT p.id AS "productId", a.alias
  FROM "Product" p
  CROSS JOIN LATERAL (
    SELECT pa.id, pa.alias
    FROM "ProductAlias" pa
    WHERE pa."productId" = p.id
    ORDER BY pa.id ASC
    LIMIT ${PRODUCT_CARD_ALIAS_LIMIT}
  ) a
  WHERE p.id = ANY(${[...productIds]}::text[])
  ORDER BY p.id ASC, a.id ASC
`;

/** Groups the rows per product, keeping each product's alias-id order. */
export const groupProductCardAliases = (
  rows: readonly ProductCardAliasRow[],
): Map<string, ProductCardAlias[]> => {
  const byProduct = new Map<string, ProductCardAlias[]>();
  for (const row of rows) {
    const list = byProduct.get(row.productId);
    if (list) {
      list.push({ alias: row.alias });
    } else {
      byProduct.set(row.productId, [{ alias: row.alias }]);
    }
  }
  return byProduct;
};

/**
 * Errors propagate unchanged, exactly as they did when the aliases were part of the
 * page's `product.findMany`.
 */
export const loadProductCardAliases = async (
  productIds: readonly string[],
): Promise<Map<string, ProductCardAlias[]>> => {
  if (productIds.length === 0) return new Map();
  const rows = await db.$queryRaw<ProductCardAliasRow[]>(buildProductCardAliasesSql(productIds));
  return groupProductCardAliases(rows);
};
