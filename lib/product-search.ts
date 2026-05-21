import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma";
import type { Product, Prisma as PrismaTypes } from "@/lib/generated/prisma";
import { unstable_cache } from "next/cache";
import { expandQueryTokens } from "@/lib/search-synonyms";

const SEARCH_V2_CODE_SIMILARITY = 0.2;
const SEARCH_V2_NAME_SIMILARITY = 0.18;
const SEARCH_V2_TEXT_SIMILARITY = 0.12;
const SEARCH_V2_OEM_SIMILARITY = 0.2;

type ProductSearchOrder = "createdAtDesc" | "codeDesc";

type ProductSearchInput = {
  query?: string | null;
  isActive?: boolean;
  categoryName?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  carBrandId?: string | null;
  carModelId?: string | null;
  carBrandName?: string | null;
  carModelName?: string | null;
  carModelNames?: string[] | null;
  /** Optional explicit fitment year filter (e.g. user selected from dropdown) */
  fitmentYear?: number | null;
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

/** Auto-detect a 4-digit year (1900-2200) in the user query. */
export const extractYearFromQuery = (query?: string | null): number | null => {
  if (!query) return null;
  const match = query.match(/\b(19|20|21)\d{2}\b/);
  if (!match) return null;
  const y = parseInt(match[0], 10);
  return y >= 1900 && y <= 2200 ? y : null;
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
    // ProductAlias covers ALIAS / OEM / PART_NO / CROSS_REF / KEYWORD / MISSPELL / EN / TH
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
  categoryId,
  brandId,
  carBrandId,
  carModelId,
  carBrandName,
  carModelNames,
  carModelName,
}: Pick<
  ProductSearchInput,
  "query" | "isActive" | "categoryName" | "categoryId" | "brandId" | "carBrandId" | "carModelId" | "carBrandName" | "carModelName" | "carModelNames"
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

  if (categoryId) {
    where.categoryId = categoryId;
  }

  if (brandId) {
    where.brandId = brandId;
  }

  if (carModelId) {
    where.carModels = { some: { carModelId } };
  } else if (carBrandId) {
    where.carModels = {
      some: {
        carModel: {
          carBrandId,
        },
      },
    };
  }

  if (!carBrandId && !carModelId && carBrandName && normalizedCarModelNames.length > 0) {
    where.carModels = {
      some: {
        carModel: {
          name: { in: normalizedCarModelNames },
          carBrand: { name: carBrandName },
        },
      },
    };
  } else if (!carBrandId && !carModelId && carBrandName) {
    where.carModels = {
      some: {
        carModel: {
          carBrand: { name: carBrandName },
        },
      },
    };
  } else if (!carBrandId && !carModelId && normalizedCarModelNames.length > 0) {
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

/**
 * Build a year-aware filter for the Prisma fallback path.
 * Lenient (Q3=B): match fitment rows where year is in range OR all year fields are null.
 */
const applyYearFilter = (
  where: PrismaTypes.ProductWhereInput,
  targetYear: number | null,
): PrismaTypes.ProductWhereInput => {
  if (targetYear === null) return where;

  const yearCondition: PrismaTypes.ProductWhereInput = {
    carModels: {
      some: {
        OR: [
          { yearStart: null, yearEnd: null },
          { yearStart: null, yearEnd: { gte: targetYear } },
          { yearEnd: null, yearStart: { lte: targetYear } },
          {
            AND: [
              { yearStart: { lte: targetYear } },
              { yearEnd: { gte: targetYear } },
            ],
          },
        ],
      },
    },
  };

  const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
  return { ...where, AND: [...existingAnd, yearCondition] };
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
  const baseWhere = buildProductFilterWhere(input);
  const targetYear = input.fitmentYear ?? extractYearFromQuery(input.query);
  const where = applyYearFilter(baseWhere, targetYear);
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

  // Phase D: expand user query through the synonym dictionary so search covers
  // bi-directional matches (e.g. "คอมแอร์" → also tries "compressor"/"คอมเพรสเซอร์").
  const expandedTokens = await expandQueryTokens(normalizedQuery);

  // Build a single OR-tsquery from all expanded tokens. We sanitize each token
  // into the simple `to_tsquery` lexeme form (alphanumeric and Thai chars only;
  // anything else becomes a space) so user input can never inject tsquery syntax.
  const sanitizedTsTokens = expandedTokens
    .map((token) => token.replace(/[^\p{L}\p{N}_-]+/gu, " ").trim())
    .map((token) => token.replace(/\s+/g, " "))
    .filter((token) => token.length > 0)
    .map((token) => token.split(" ").map((word) => `${word}:*`).join(" & "))
    .filter((expr) => expr.length > 0);

  const tsQueryExpression = sanitizedTsTokens.length > 0
    ? sanitizedTsTokens.map((expr) => `(${expr})`).join(" | ")
    : normalizedQuery.replace(/[^\p{L}\p{N}_-]+/gu, " ").trim() || normalizedQuery;

  const tsQuery = Prisma.sql`to_tsquery('simple', ${tsQueryExpression})`;

  // Year filter: explicit `fitmentYear` from UI, else auto-detect from query
  const targetYear = input.fitmentYear ?? extractYearFromQuery(normalizedQuery);

  // When the user types a pure 4-digit year (e.g. "1901"), the fitment_text
  // stores ranges as literal "1900-1904" so substring/FTS won't match interior
  // years. Skip the AND text-match clause and rely solely on the yearFilter
  // (already enforced via exactScope) — yearBoost gives score > 0 so results
  // still pass the ranked.score > 0 cut.
  const isYearOnlyQuery = targetYear !== null && /^\d{4}$/.test(normalizedQuery);

  // Year filter:
  //  - Year-only query (e.g. "2010"): strict — require at least one fitment row
  //    that explicitly covers the year. Exclude NULL/NULL rows so products
  //    without year info don't flood results.
  //  - Mixed query (e.g. "ผ้าเบรค Vios 2010"): lenient — also accept NULL/NULL
  //    because the text-match clause already constrains the candidate set.
  const yearFilterClause = targetYear !== null
    ? isYearOnlyQuery
      ? Prisma.sql`
          AND EXISTS (
            SELECT 1
            FROM "ProductCarModel" pcm
            WHERE pcm."productId" = psd.product_id
              AND (
                (pcm."yearStart" IS NULL AND ${targetYear} <= pcm."yearEnd")
                OR (pcm."yearEnd" IS NULL AND ${targetYear} >= pcm."yearStart")
                OR (${targetYear} BETWEEN pcm."yearStart" AND pcm."yearEnd")
              )
          )
        `
      : Prisma.sql`
          AND EXISTS (
            SELECT 1
            FROM "ProductCarModel" pcm
            WHERE pcm."productId" = psd.product_id
              AND (
                (pcm."yearStart" IS NULL AND pcm."yearEnd" IS NULL)
                OR (pcm."yearStart" IS NULL AND ${targetYear} <= pcm."yearEnd")
                OR (pcm."yearEnd" IS NULL AND ${targetYear} >= pcm."yearStart")
                OR (${targetYear} BETWEEN pcm."yearStart" AND pcm."yearEnd")
              )
          )
        `
    : Prisma.empty;

  // Year boost (Q3=C): +700 when a fitment row covers the requested year explicitly
  const yearBoostExpr = targetYear !== null
    ? Prisma.sql`
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM "ProductCarModel" pcm
            WHERE pcm."productId" = psd.product_id
              AND (
                (${targetYear} BETWEEN pcm."yearStart" AND pcm."yearEnd")
                OR (pcm."yearStart" IS NULL AND ${targetYear} <= pcm."yearEnd")
                OR (pcm."yearEnd" IS NULL AND ${targetYear} >= pcm."yearStart")
              )
          ) THEN 700
          ELSE 0
        END
      `
    : Prisma.sql`0`;

  const isActiveClause =
    typeof input.isActive === "boolean"
      ? Prisma.sql`AND psd.is_active = ${input.isActive}`
      : Prisma.empty;

  const categoryClause = input.categoryName
    ? Prisma.sql`AND psd.category_name = ${input.categoryName}`
    : Prisma.empty;

  const categoryIdClause = input.categoryId
    ? Prisma.sql`
        AND EXISTS (
          SELECT 1
          FROM "Product" p
          WHERE p.id = psd.product_id
            AND p."categoryId" = ${input.categoryId}
        )
      `
    : Prisma.empty;

  const brandIdClause = input.brandId
    ? Prisma.sql`
        AND EXISTS (
          SELECT 1
          FROM "Product" p
          WHERE p.id = psd.product_id
            AND p."brandId" = ${input.brandId}
        )
      `
    : Prisma.empty;

  const carBrandIdClause = input.carBrandId
    ? Prisma.sql`
        AND EXISTS (
          SELECT 1
          FROM "ProductCarModel" pcm
          INNER JOIN "CarModel" cm ON cm.id = pcm."carModelId"
          WHERE pcm."productId" = psd.product_id
            AND cm."carBrandId" = ${input.carBrandId}
        )
      `
    : Prisma.empty;

  const carModelIdClause = input.carModelId
    ? Prisma.sql`
        AND EXISTS (
          SELECT 1
          FROM "ProductCarModel" pcm
          WHERE pcm."productId" = psd.product_id
            AND pcm."carModelId" = ${input.carModelId}
        )
      `
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
      ${categoryIdClause}
      ${brandIdClause}
      ${carBrandIdClause}
      ${carModelIdClause}
      ${carBrandClause}
      ${carModelClause}
      ${yearFilterClause}
  `;

  const exactCodeRows = await db.$queryRaw<ExactSearchRow[]>(Prisma.sql`
    SELECT psd.product_id, COUNT(*) OVER() AS total_count
    FROM product_search_documents psd
    ${exactScope}
      AND (
        lower(psd.product_code) = lower(${normalizedQuery})
        OR psd.oem_text ILIKE ${`%${normalizedQuery}%`}
           AND EXISTS (
             SELECT 1 FROM regexp_split_to_table(psd.oem_text, '\s+') AS tok(tok)
             WHERE lower(tok.tok) = lower(${normalizedQuery})
           )
      )
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
          -- Exact matches (highest priority)
          CASE WHEN lower(psd.product_code) = lower(${normalizedQuery}) THEN 1500 ELSE 0 END +
          CASE WHEN lower(psd.oem_text) ~ ('(^|\s)' || lower(${normalizedQuery}) || '($|\s)') THEN 1400 ELSE 0 END +
          CASE WHEN lower(psd.product_name) = lower(${normalizedQuery}) THEN 1000 ELSE 0 END +
          CASE WHEN lower(psd.search_text) = lower(${normalizedQuery}) THEN 800 ELSE 0 END +

          -- Prefix / contains
          CASE WHEN lower(psd.product_code) LIKE lower(${prefixQuery}) THEN 380 ELSE 0 END +
          CASE WHEN lower(psd.product_name) LIKE lower(${prefixQuery}) THEN 320 ELSE 0 END +
          CASE WHEN lower(psd.oem_text) LIKE lower(${containsQuery}) THEN 600 ELSE 0 END +
          CASE WHEN lower(psd.keyword_text) LIKE lower(${containsQuery}) THEN 250 ELSE 0 END +
          CASE WHEN lower(psd.alias_text) LIKE lower(${containsQuery}) THEN 250 ELSE 0 END +
          CASE WHEN lower(psd.fitment_text) LIKE lower(${containsQuery}) THEN 200 ELSE 0 END +
          CASE WHEN lower(psd.product_description) LIKE lower(${containsQuery}) THEN 80 ELSE 0 END +

          -- Full-text rank
          CASE
            WHEN psd.search_document @@ ${tsQuery}
            THEN ts_rank_cd(psd.search_document, ${tsQuery}) * 220
            ELSE 0
          END +

          -- Year-match boost (Phase C Q3=C)
          ${yearBoostExpr} +

          -- Trigram fuzzy
          GREATEST(
            similarity(lower(psd.product_code), lower(${normalizedQuery})) * 420,
            similarity(lower(psd.oem_text), lower(${normalizedQuery})) * 380,
            similarity(lower(psd.product_name), lower(${normalizedQuery})) * 250,
            similarity(lower(psd.keyword_text), lower(${normalizedQuery})) * 180,
            similarity(lower(psd.search_text), lower(${normalizedQuery})) * 120
          )
        ) AS score
      FROM product_search_documents psd
      ${exactScope}
        ${isYearOnlyQuery ? Prisma.empty : Prisma.sql`AND (
          lower(psd.product_code) = lower(${normalizedQuery})
          OR lower(psd.product_name) = lower(${normalizedQuery})
          OR lower(psd.product_code) LIKE lower(${prefixQuery})
          OR lower(psd.product_name) LIKE lower(${prefixQuery})
          OR lower(psd.oem_text) LIKE lower(${containsQuery})
          OR lower(psd.keyword_text) LIKE lower(${containsQuery})
          OR lower(psd.alias_text) LIKE lower(${containsQuery})
          OR lower(psd.search_text) LIKE lower(${containsQuery})
          OR psd.search_document @@ ${tsQuery}
          OR similarity(lower(psd.product_code), lower(${normalizedQuery})) >= ${SEARCH_V2_CODE_SIMILARITY}
          OR similarity(lower(psd.oem_text), lower(${normalizedQuery})) >= ${SEARCH_V2_OEM_SIMILARITY}
          OR similarity(lower(psd.product_name), lower(${normalizedQuery})) >= ${SEARCH_V2_NAME_SIMILARITY}
          OR similarity(lower(psd.search_text), lower(${normalizedQuery})) >= ${SEARCH_V2_TEXT_SIMILARITY}
        )`}
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
    categoryId: input.categoryId ?? "",
    brandId: input.brandId ?? "",
    carBrandId: input.carBrandId ?? "",
    carModelId: input.carModelId ?? "",
    carBrandName: input.carBrandName ?? "",
    carModelNames: normalizeCarModelNames(input),
    fitmentYear: input.fitmentYear ?? null,
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
