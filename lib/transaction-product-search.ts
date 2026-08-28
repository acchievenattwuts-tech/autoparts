import { createHash } from "node:crypto";

import { unstable_cache } from "next/cache";

import { db, withDbRetry } from "@/lib/db";
import { Prisma, type InventoryTracking, type LotIssueMethod } from "@/lib/generated/prisma";
import {
  compressJsonForCache,
  decompressJsonFromCache,
} from "@/lib/json-cache-compression";

export const TRANSACTION_PRODUCT_SEARCH_MIN_CHARS = 3;
export const TRANSACTION_PRODUCT_SEARCH_LIMIT = 50;

const CATALOG_REVALIDATE_SECONDS = 86_400;
const TRANSACTION_PRODUCT_OPTIONS_TAG = "admin-transaction:product-options";
const DESCRIPTION_MAX_CHARS = 300;

export type TransactionProductCatalogItem = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  categoryName: string;
  brandName: string | null;
  aliasSearchText: string;
  isActive: boolean;
};

export type TransactionProductDetailRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  salePrice: number;
  retailPrice: number;
  memberPrice: number;
  priceListPrices: Record<string, number>;
  pricePromotions: Array<{
    id: string;
    priceListCode: string;
    startDateKey: string;
    endDateKey: string;
    promotionPrice: number;
  }>;
  costPrice: number;
  avgCost: number;
  saleUnitName: string;
  purchaseUnitName: string;
  warrantyDays: number;
  inventoryTracking: InventoryTracking;
  isLotControl: boolean;
  lotIssueMethod: LotIssueMethod;
  allowExpiredIssue: boolean;
  requireExpiryDate: boolean;
  preferredSupplierId: string | null;
  preferredSupplierName: string | null;
  preferredSupplierActive: boolean;
  categoryName: string;
  brandName: string | null;
  units: { name: string; scale: number; isBase: boolean }[];
  isActive: boolean;
};

type RawDetailRow = Omit<
  TransactionProductDetailRow,
  "salePrice" | "retailPrice" | "memberPrice" | "priceListPrices" | "pricePromotions" | "costPrice" | "avgCost" | "units"
> & {
  salePrice: unknown;
  retailPrice: unknown;
  memberPrice: unknown;
  priceListPrices: Record<string, unknown> | null;
  pricePromotions: Array<{
    id: string;
    priceListCode: string;
    startDateKey: string;
    endDateKey: string;
    promotionPrice: unknown;
  }> | null;
  costPrice: unknown;
  avgCost: unknown;
  units: Array<{ name: string; scale: unknown; isBase: boolean }> | null;
};

const mapRawDetailRow = (row: RawDetailRow): TransactionProductDetailRow => ({
  ...row,
  salePrice: Number(row.salePrice),
  retailPrice: Number(row.retailPrice),
  memberPrice: Number(row.memberPrice),
  priceListPrices: Object.fromEntries(
    Object.entries(row.priceListPrices ?? {}).map(([code, amount]) => [code, Number(amount)]),
  ),
  pricePromotions: (row.pricePromotions ?? []).map((promotion) => ({
    ...promotion,
    promotionPrice: Number(promotion.promotionPrice),
  })),
  costPrice: Number(row.costPrice),
  avgCost: Number(row.avgCost),
  units: (row.units ?? []).map((unit) => ({
    name: unit.name,
    scale: Number(unit.scale),
    isBase: unit.isBase,
  })),
});

const queryDetailRows = async (candidateSql: Prisma.Sql): Promise<TransactionProductDetailRow[]> => {
  const rows = await withDbRetry(() => db.$queryRaw<RawDetailRow[]>`
    WITH candidate_ids AS (${candidateSql})
    SELECT
      p.id,
      p.code,
      p.name,
      left(p.description, ${DESCRIPTION_MAX_CHARS}) AS description,
      p."salePrice" AS "salePrice",
      p."retailPrice" AS "retailPrice",
      p."memberPrice" AS "memberPrice",
      COALESCE(
        (
          SELECT jsonb_object_agg(price_list.code, product_price.amount)
          FROM "ProductPrice" product_price
          INNER JOIN "PriceList" price_list ON price_list.id = product_price."priceListId"
          WHERE product_price."productId" = p.id AND price_list."isActive" = true
        ),
        '{}'::jsonb
      ) AS "priceListPrices",
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', promotion.id,
              'priceListCode', promotion_list.code,
              'startDateKey', to_char(promotion."startDate" AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD'),
              'endDateKey', to_char(promotion."endDate" AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD'),
              'promotionPrice', promotion_item."promotionPrice"
            )
            ORDER BY promotion."startDate", promotion.id
          )
          FROM "PricePromotionItem" promotion_item
          INNER JOIN "PricePromotion" promotion ON promotion.id = promotion_item."promotionId"
          INNER JOIN "PriceList" promotion_list ON promotion_list.id = promotion."priceListId"
          WHERE promotion_item."productId" = p.id AND promotion.status = 'PUBLISHED'
        ),
        '[]'::jsonb
      ) AS "pricePromotions",
      p."costPrice" AS "costPrice",
      p."avgCost" AS "avgCost",
      p."saleUnitName" AS "saleUnitName",
      p."purchaseUnitName" AS "purchaseUnitName",
      p."warrantyDays" AS "warrantyDays",
      p."inventoryTracking" AS "inventoryTracking",
      p."isLotControl" AS "isLotControl",
      p."lotIssueMethod" AS "lotIssueMethod",
      p."allowExpiredIssue" AS "allowExpiredIssue",
      p."requireExpiryDate" AS "requireExpiryDate",
      p."preferredSupplierId" AS "preferredSupplierId",
      supplier.name AS "preferredSupplierName",
      COALESCE(supplier."isActive", false) AS "preferredSupplierActive",
      category.name AS "categoryName",
      brand.name AS "brandName",
      p."isActive" AS "isActive",
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object('name', unit.name, 'scale', unit.scale, 'isBase', unit."isBase")
            ORDER BY unit."isBase" DESC, unit.id ASC
          )
          FROM "ProductUnit" unit
          WHERE unit."productId" = p.id
        ),
        '[]'::jsonb
      ) AS units
    FROM candidate_ids candidate
    INNER JOIN "Product" p ON p.id = candidate.id
    INNER JOIN "Category" category ON category.id = p."categoryId"
    LEFT JOIN "PartsBrand" brand ON brand.id = p."brandId"
    LEFT JOIN "Supplier" supplier ON supplier.id = p."preferredSupplierId"
    ORDER BY candidate.code ASC, candidate.id ASC
  `);
  return rows.map(mapRawDetailRow);
};

export const searchTransactionProductDetailRows = async (
  query: string,
): Promise<TransactionProductDetailRow[]> => {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < TRANSACTION_PRODUCT_SEARCH_MIN_CHARS) return [];
  const escapedQuery = normalizedQuery.replace(/[\\%_]/g, "\\$&");
  const containsQuery = `%${escapedQuery}%`;

  return queryDetailRows(Prisma.sql`
    SELECT matched.id, product.code
    FROM (
      SELECT p.id
      FROM "Product" p
      INNER JOIN "Category" category ON category.id = p."categoryId"
      LEFT JOIN "PartsBrand" brand ON brand.id = p."brandId"
      WHERE lower(p.code) LIKE lower(${containsQuery}) ESCAPE '\'
        OR lower(p.name) LIKE lower(${containsQuery}) ESCAPE '\'
        OR lower(left(COALESCE(p.description, ''), ${DESCRIPTION_MAX_CHARS})) LIKE lower(${containsQuery}) ESCAPE '\'
        OR lower(category.name) LIKE lower(${containsQuery}) ESCAPE '\'
        OR lower(COALESCE(brand.name, '')) LIKE lower(${containsQuery}) ESCAPE '\'

      UNION

      SELECT alias."productId" AS id
      FROM "ProductAlias" alias
      WHERE f_unaccent(lower(alias.alias)) LIKE f_unaccent(lower(${containsQuery})) ESCAPE '\'
        AND lower(alias.alias) LIKE lower(${containsQuery}) ESCAPE '\'
    ) matched
    INNER JOIN "Product" product ON product.id = matched.id
    ORDER BY product.code ASC, matched.id ASC
    LIMIT ${TRANSACTION_PRODUCT_SEARCH_LIMIT}
  `);
};

export const getTransactionProductDetailRowsByIds = async (
  ids: readonly string[],
): Promise<TransactionProductDetailRow[]> => {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) return [];
  return queryDetailRows(Prisma.sql`
    SELECT p.id, p.code
    FROM "Product" p
    WHERE p.id IN (${Prisma.join(uniqueIds)})
  `);
};

export const buildTransactionProductCatalog = async (): Promise<TransactionProductCatalogItem[]> => {
  const [products, aliases] = await Promise.all([
    withDbRetry(() => db.product.findMany({
      orderBy: [{ code: "asc" }, { id: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        isActive: true,
        category: { select: { name: true } },
        brand: { select: { name: true } },
      },
    })),
    withDbRetry(() => db.$queryRaw<Array<{ productId: string; aliasSearchText: string | null }>>`
      SELECT
        "productId",
        string_agg(DISTINCT lower(alias), E'\\n' ORDER BY lower(alias)) AS "aliasSearchText"
      FROM "ProductAlias"
      GROUP BY "productId"
    `),
  ]);
  const aliasByProduct = new Map(aliases.map((row) => [row.productId, row.aliasSearchText ?? ""]));
  return products.map((product) => ({
    id: product.id,
    code: product.code,
    name: product.name,
    description: product.description?.slice(0, DESCRIPTION_MAX_CHARS) ?? null,
    categoryName: product.category.name,
    brandName: product.brand?.name ?? null,
    aliasSearchText: aliasByProduct.get(product.id) ?? "",
    isActive: product.isActive,
  }));
};

const getCompressedCatalog = unstable_cache(
  async () => compressJsonForCache(await buildTransactionProductCatalog()),
  ["admin-transaction-product-search-catalog-gzip-v1"],
  {
    tags: [TRANSACTION_PRODUCT_OPTIONS_TAG],
    revalidate: CATALOG_REVALIDATE_SECONDS,
  },
);

export const getTransactionProductCatalogResponse = async (): Promise<{
  etag: string;
  products: TransactionProductCatalogItem[];
}> => {
  const payload = await getCompressedCatalog();
  return {
    etag: `"${createHash("sha256").update(payload).digest("base64url")}"`,
    products: await decompressJsonFromCache<TransactionProductCatalogItem[]>(payload),
  };
};
