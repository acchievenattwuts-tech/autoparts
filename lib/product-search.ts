import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma";
import type { Product, Prisma as PrismaTypes } from "@/lib/generated/prisma";
import { unstable_cache } from "next/cache";

const SEARCH_V2_CODE_SIMILARITY = 0.2;
const SEARCH_V2_NAME_SIMILARITY = 0.18;
const SEARCH_V2_TEXT_SIMILARITY = 0.12;

type ProductSearchOrder = "createdAtDesc" | "codeDesc";

type ProductSearchInput = {
  query?: string | null;
  isActive?: boolean;
  categoryName?: string | null;
  carBrandName?: string | null;
  carModelName?: string | null;
  carModelNames?: string[] | null;
  skip?: number;
  take?: number;
  order?: ProductSearchOrder;
};

type ProductSearchResult = {
  ids: string[];
  total: number;
  mode: "v2" | "fallback";
};

type RankedSearchRow = {
  product_id: string;
  total_count: bigint | number | string;
};

type ExactSearchRow = {
  product_id: string;
  total_count: bigint | number | string;
};

const normalizeSearchQuery = (query?: string | null): string | undefined => {
  const normalized = query?.trim();
  return normalized ? normalized : undefined;
};

const normalizeCarModelNames = (input: ProductSearchInput): string[] => {
  const names = input.carModelNames ?? (input.carModelName ? [input.carModelName] : []);

  return Array.from(new Set(names.map((item) => item.trim()).filter(Boolean)));
};

const buildContainsCondition = (
  query: string,
): PrismaTypes.ProductWhereInput => ({
  OR: [
    { name: { contains: query, mode: "insensitive" } },
    { code: { contains: query, mode: "insensitive" } },
    { description: { contains: query, mode: "insensitive" } },
    { aliases: { some: { alias: { contains: query, mode: "insensitive" } } } },
    {
      carModels: {
        some: {
          carModel: {
            name: { contains: query, mode: "insensitive" },
          },
        },
      },
    },
    {
      carModels: {
        some: {
          carModel: {
            carBrand: {
              name: { contains: query, mode: "insensitive" },
            },
          },
        },
      },
    },
    { category: { name: { contains: query, mode: "insensitive" } } },
    { brand: { name: { contains: query, mode: "insensitive" } } },
  ],
});

export const buildProductSearchWhere = (
  query?: string | null,
): PrismaTypes.ProductWhereInput | undefined => {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) {
    return undefined;
  }

  return buildContainsCondition(normalized);
};

const buildProductFilterWhere = ({
  query,
  isActive,
  categoryName,
  carBrandName,
  carModelNames,
  carModelName,
}: Pick<
  ProductSearchInput,
  "query" | "isActive" | "categoryName" | "carBrandName" | "carModelName" | "carModelNames"
>): PrismaTypes.ProductWhereInput => {
  const where: PrismaTypes.ProductWhereInput = {};
  const searchWhere = buildProductSearchWhere(query);
  const normalizedCarModelNames = normalizeCarModelNames({ carModelName, carModelNames });

  if (typeof isActive === "boolean") {
    where.isActive = isActive;
  }

  if (categoryName) {
    where.category = { name: categoryName };
  }

  if (carBrandName && normalizedCarModelNames.length > 0) {
    where.carModels = {
      some: {
        carModel: {
          name: { in: normalizedCarModelNames },
          carBrand: { name: carBrandName },
        },
      },
    };
  } else if (carBrandName) {
    where.carModels = {
      some: {
        carModel: {
          carBrand: { name: carBrandName },
        },
      },
    };
  } else if (normalizedCarModelNames.length > 0) {
    where.carModels = {
      some: {
        carModel: {
          name: { in: normalizedCarModelNames },
        },
      },
    };
  }

  if (!searchWhere) {
    return where;
  }

  return {
    AND: [where, searchWhere],
  };
};

const getFallbackOrderBy = (
  order: ProductSearchOrder,
): PrismaTypes.ProductOrderByWithRelationInput => {
  if (order === "codeDesc") {
    return { code: "desc" };
  }

  return { createdAt: "desc" };
};

const coerceCount = (value: bigint | number | string): number => {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  return parseInt(value, 10);
};

async function searchProductIdsFallback(
  input: ProductSearchInput,
): Promise<ProductSearchResult> {
  const where = buildProductFilterWhere(input);
  const skip = input.skip ?? 0;
  const take = input.take ?? 30;
  const order = input.order ?? "createdAtDesc";

  const [rows, total] = await Promise.all([
    db.product.findMany({
      where,
      select: { id: true },
      orderBy: getFallbackOrderBy(order),
      skip,
      take,
    }),
    db.product.count({ where }),
  ]);

  return {
    ids: rows.map((row) => row.id),
    total,
    mode: "fallback",
  };
}

async function searchProductIdsV2(
  input: ProductSearchInput,
): Promise<ProductSearchResult> {
  const normalizedQuery = normalizeSearchQuery(input.query);
  const normalizedCarModelNames = normalizeCarModelNames(input);

  if (!normalizedQuery) {
    return searchProductIdsFallback(input);
  }

  const skip = input.skip ?? 0;
  const take = input.take ?? 30;
  const prefixQuery = `${normalizedQuery}%`;
  const containsQuery = `%${normalizedQuery}%`;
  const tsQuery = Prisma.sql`plainto_tsquery('simple', ${normalizedQuery})`;

  const isActiveClause =
    typeof input.isActive === "boolean"
      ? Prisma.sql`AND psd.is_active = ${input.isActive}`
      : Prisma.empty;

  const categoryClause = input.categoryName
    ? Prisma.sql`AND psd.category_name = ${input.categoryName}`
    : Prisma.empty;

  const carBrandClause = input.carBrandName
    ? Prisma.sql`
        AND EXISTS (
          SELECT 1
          FROM "ProductCarModel" pcm
          INNER JOIN "CarModel" cm ON cm.id = pcm."carModelId"
          INNER JOIN "CarBrand" cb ON cb.id = cm."carBrandId"
          WHERE pcm."productId" = psd.product_id
            AND cb.name = ${input.carBrandName}
        )
      `
    : Prisma.empty;

  const carModelClause = normalizedCarModelNames.length > 0
    ? Prisma.sql`
        AND EXISTS (
          SELECT 1
          FROM "ProductCarModel" pcm
          INNER JOIN "CarModel" cm ON cm.id = pcm."carModelId"
          WHERE pcm."productId" = psd.product_id
            AND cm.name IN (${Prisma.join(normalizedCarModelNames)})
        )
      `
    : Prisma.empty;

  const exactScope = Prisma.sql`
    WHERE TRUE
      ${isActiveClause}
      ${categoryClause}
      ${carBrandClause}
      ${carModelClause}
  `;

  const exactCodeRows = await db.$queryRaw<ExactSearchRow[]>(Prisma.sql`
    SELECT psd.product_id, COUNT(*) OVER() AS total_count
    FROM product_search_documents psd
    ${exactScope}
      AND lower(psd.product_code) = lower(${normalizedQuery})
    ORDER BY psd.product_created_at DESC, psd.product_id DESC
    OFFSET ${skip}
    LIMIT ${take}
  `);

  if (exactCodeRows.length > 0) {
    return {
      ids: exactCodeRows.map((row) => row.product_id),
      total: coerceCount(exactCodeRows[0].total_count),
      mode: "v2",
    };
  }

  const exactNameRows = await db.$queryRaw<ExactSearchRow[]>(Prisma.sql`
    SELECT psd.product_id, COUNT(*) OVER() AS total_count
    FROM product_search_documents psd
    ${exactScope}
      AND lower(psd.product_name) = lower(${normalizedQuery})
    ORDER BY psd.product_created_at DESC, psd.product_id DESC
    OFFSET ${skip}
    LIMIT ${take}
  `);

  if (exactNameRows.length > 0) {
    return {
      ids: exactNameRows.map((row) => row.product_id),
      total: coerceCount(exactNameRows[0].total_count),
      mode: "v2",
    };
  }

  const rows = await db.$queryRaw<RankedSearchRow[]>(Prisma.sql`
    WITH ranked AS (
      SELECT
        psd.product_id,
        psd.product_created_at,
        (
          CASE WHEN lower(psd.product_code) = lower(${normalizedQuery}) THEN 1200 ELSE 0 END +
          CASE WHEN lower(psd.product_name) = lower(${normalizedQuery}) THEN 1000 ELSE 0 END +
          CASE WHEN lower(psd.search_text) = lower(${normalizedQuery}) THEN 800 ELSE 0 END +
          CASE WHEN lower(psd.product_code) LIKE lower(${prefixQuery}) THEN 380 ELSE 0 END +
          CASE WHEN lower(psd.product_name) LIKE lower(${prefixQuery}) THEN 320 ELSE 0 END +
          CASE WHEN lower(psd.search_text) LIKE lower(${containsQuery}) THEN 140 ELSE 0 END +
          CASE
            WHEN psd.search_document @@ ${tsQuery}
            THEN ts_rank_cd(psd.search_document, ${tsQuery}) * 220
            ELSE 0
          END +
          GREATEST(
            similarity(lower(psd.product_code), lower(${normalizedQuery})) * 420,
            similarity(lower(psd.product_name), lower(${normalizedQuery})) * 250,
            similarity(lower(psd.search_text), lower(${normalizedQuery})) * 120
          )
        ) AS score
      FROM product_search_documents psd
      ${exactScope}
        AND (
          lower(psd.product_code) = lower(${normalizedQuery})
          OR lower(psd.product_name) = lower(${normalizedQuery})
          OR lower(psd.product_code) LIKE lower(${prefixQuery})
          OR lower(psd.product_name) LIKE lower(${prefixQuery})
          OR lower(psd.search_text) LIKE lower(${containsQuery})
          OR psd.search_document @@ ${tsQuery}
          OR similarity(lower(psd.product_code), lower(${normalizedQuery})) >= ${SEARCH_V2_CODE_SIMILARITY}
          OR similarity(lower(psd.product_name), lower(${normalizedQuery})) >= ${SEARCH_V2_NAME_SIMILARITY}
          OR similarity(lower(psd.search_text), lower(${normalizedQuery})) >= ${SEARCH_V2_TEXT_SIMILARITY}
        )
    )
    SELECT
      ranked.product_id,
      COUNT(*) OVER() AS total_count
    FROM ranked
    WHERE ranked.score > 0
    ORDER BY ranked.score DESC, ranked.product_created_at DESC, ranked.product_id DESC
    OFFSET ${skip}
    LIMIT ${take}
  `);

  return {
    ids: rows.map((row) => row.product_id),
    total: rows.length > 0 ? coerceCount(rows[0].total_count) : 0,
    mode: "v2",
  };
}

export async function searchProductIds(
  input: ProductSearchInput,
): Promise<ProductSearchResult> {
  const cacheKey = JSON.stringify({
    query: normalizeSearchQuery(input.query) ?? "",
    isActive: input.isActive ?? null,
    categoryName: input.categoryName ?? "",
    carBrandName: input.carBrandName ?? "",
    carModelNames: normalizeCarModelNames(input),
    skip: input.skip ?? 0,
    take: input.take ?? 30,
    order: input.order ?? "createdAtDesc",
  });

  return unstable_cache(
    async () => {
      const normalizedQuery = normalizeSearchQuery(input.query);

      if (!normalizedQuery) {
        return searchProductIdsFallback(input);
      }

      try {
        return await searchProductIdsV2(input);
      } catch (error) {
        console.error("Search V2 failed, falling back to Prisma contains search.", error);
        return searchProductIdsFallback(input);
      }
    },
    [`product-search:${cacheKey}`],
    { tags: ["product-search"], revalidate: 300 },
  )();
}

export function sortProductsByIds<T extends Pick<Product, "id">>(
  products: T[],
  ids: string[],
): T[] {
  const order = new Map(ids.map((id, index) => [id, index]));

  return [...products].sort((left, right) => {
    const leftIndex = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
}
