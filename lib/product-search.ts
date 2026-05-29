import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma";
import type { Product, Prisma as PrismaTypes } from "@/lib/generated/prisma";
import { unstable_cache } from "next/cache";
import {
  getProductSearchCacheTtl,
  PRODUCT_SEARCH_TAG,
  type ProductSearchCacheProfile,
} from "@/lib/product-search-cache";
import { expandQueryTokens } from "@/lib/search-synonyms";
import { normalizeSearchText } from "@/lib/search-normalization";

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
  cacheProfile?: ProductSearchCacheProfile;
};

/** Phase Q5 — Match reasons per product (chip labels in UI). */
export type ProductMatchReason =
  | "code"
  | "oem"
  | "name"
  | "keyword"
  | "fitment"
  | "year";

type ProductSearchResult = {
  ids: string[];
  total: number;
  mode: "v2" | "fallback";
  /** productId -> match reasons (Phase Q5). Empty map if no query. */
  matchReasons?: Record<string, ProductMatchReason[]>;
};

type RankedSearchRow = {
  product_id: string;
  total_count: bigint | number | string;
  match_code?: boolean | null;
  match_oem?: boolean | null;
  match_name?: boolean | null;
  match_keyword?: boolean | null;
  match_fitment?: boolean | null;
  match_year?: boolean | null;
};

type ExactSearchRow = {
  product_id: string;
  total_count: bigint | number | string;
};

const normalizeSearchQuery = (query?: string | null): string | undefined => {
  const normalized = normalizeSearchText(query);
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
    matchReasons: {},
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
    .map((token) => token.replace(/[^\p{L}\p{M}\p{N}_-]+/gu, " ").trim())
    .map((token) => token.replace(/\s+/g, " "))
    .filter((token) => token.length > 0)
    .map((token) => token.split(" ").map((word) => `${word}:*`).join(" & "))
    .filter((expr) => expr.length > 0);

  const tsQueryExpression = sanitizedTsTokens.length > 0
    ? sanitizedTsTokens.map((expr) => `(${expr})`).join(" | ")
    : normalizedQuery.replace(/[^\p{L}\p{M}\p{N}_-]+/gu, " ").trim() || normalizedQuery;

  // Phase Q2: pass query through f_unaccent so it matches the unaccented tsvector index.
  const tsQuery = Prisma.sql`to_tsquery('simple', f_unaccent(${tsQueryExpression}))`;

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
        f_unaccent(lower(psd.product_code)) = f_unaccent(lower(${normalizedQuery}))
        OR (
          f_unaccent(psd.oem_text) ILIKE f_unaccent(${`%${normalizedQuery}%`})
          AND EXISTS (
            SELECT 1 FROM regexp_split_to_table(psd.oem_text, '\s+') AS tok(tok)
            WHERE f_unaccent(lower(tok.tok)) = f_unaccent(lower(${normalizedQuery}))
          )
        )
      )
    ORDER BY psd.product_created_at DESC, psd.product_id DESC
    OFFSET ${skip}
    LIMIT ${take}
  `);

  if (exactCodeRows.length > 0) {
    const reasons: Record<string, ProductMatchReason[]> = {};
    // Heuristic: exact-code branch hits when query matches product_code OR OEM token.
    // Without per-row probe we attribute "code" and let the UI dedupe; "oem" added when query looks like a part number.
    const looksLikeOem = /[-0-9]/.test(normalizedQuery);
    for (const row of exactCodeRows) {
      reasons[row.product_id] = looksLikeOem ? ["code", "oem"] : ["code"];
    }
    return {
      ids: exactCodeRows.map((row) => row.product_id),
      total: coerceCount(exactCodeRows[0].total_count),
      mode: "v2",
      matchReasons: reasons,
    };
  }

  const exactNameRows = await db.$queryRaw<ExactSearchRow[]>(Prisma.sql`
    SELECT psd.product_id, COUNT(*) OVER() AS total_count
    FROM product_search_documents psd
    ${exactScope}
      AND f_unaccent(lower(psd.product_name)) = f_unaccent(lower(${normalizedQuery}))
    ORDER BY psd.product_created_at DESC, psd.product_id DESC
    OFFSET ${skip}
    LIMIT ${take}
  `);

  if (exactNameRows.length > 0) {
    const reasons: Record<string, ProductMatchReason[]> = {};
    for (const row of exactNameRows) reasons[row.product_id] = ["name"];
    return {
      ids: exactNameRows.map((row) => row.product_id),
      total: coerceCount(exactNameRows[0].total_count),
      mode: "v2",
      matchReasons: reasons,
    };
  }

  const rows = await db.$queryRaw<RankedSearchRow[]>(Prisma.sql`
    WITH ranked AS (
      SELECT
        psd.product_id,
        psd.product_created_at,
        -- Phase Q5: per-row match reasons (booleans) for UI chip display
        (f_unaccent(lower(psd.product_code)) = f_unaccent(lower(${normalizedQuery}))
          OR f_unaccent(lower(psd.product_code)) LIKE f_unaccent(lower(${prefixQuery}))) AS match_code,
        (f_unaccent(lower(psd.oem_text)) ~ ('(^|\s)' || f_unaccent(lower(${normalizedQuery})) || '($|\s)')
          OR f_unaccent(lower(psd.oem_text)) LIKE f_unaccent(lower(${containsQuery}))) AS match_oem,
        (f_unaccent(lower(psd.product_name)) = f_unaccent(lower(${normalizedQuery}))
          OR f_unaccent(lower(psd.product_name)) LIKE f_unaccent(lower(${prefixQuery}))
          OR similarity(f_unaccent(lower(psd.product_name)), f_unaccent(lower(${normalizedQuery}))) >= ${SEARCH_V2_NAME_SIMILARITY}) AS match_name,
        (f_unaccent(lower(psd.keyword_text)) LIKE f_unaccent(lower(${containsQuery}))
          OR f_unaccent(lower(psd.alias_text)) LIKE f_unaccent(lower(${containsQuery}))) AS match_keyword,
        (f_unaccent(lower(psd.fitment_text)) LIKE f_unaccent(lower(${containsQuery}))) AS match_fitment,
        (${yearBoostExpr} > 0) AS match_year,
        (
          -- Exact matches (highest priority) — accent-insensitive (Phase Q2)
          CASE WHEN f_unaccent(lower(psd.product_code)) = f_unaccent(lower(${normalizedQuery})) THEN 1500 ELSE 0 END +
          CASE WHEN f_unaccent(lower(psd.oem_text)) ~ ('(^|\s)' || f_unaccent(lower(${normalizedQuery})) || '($|\s)') THEN 1400 ELSE 0 END +
          CASE WHEN f_unaccent(lower(psd.product_name)) = f_unaccent(lower(${normalizedQuery})) THEN 1000 ELSE 0 END +
          CASE WHEN f_unaccent(lower(psd.search_text)) = f_unaccent(lower(${normalizedQuery})) THEN 800 ELSE 0 END +

          -- Prefix / contains
          CASE WHEN f_unaccent(lower(psd.product_code)) LIKE f_unaccent(lower(${prefixQuery})) THEN 380 ELSE 0 END +
          CASE WHEN f_unaccent(lower(psd.product_name)) LIKE f_unaccent(lower(${prefixQuery})) THEN 320 ELSE 0 END +
          CASE WHEN f_unaccent(lower(psd.oem_text)) LIKE f_unaccent(lower(${containsQuery})) THEN 600 ELSE 0 END +
          CASE WHEN f_unaccent(lower(psd.keyword_text)) LIKE f_unaccent(lower(${containsQuery})) THEN 250 ELSE 0 END +
          CASE WHEN f_unaccent(lower(psd.alias_text)) LIKE f_unaccent(lower(${containsQuery})) THEN 250 ELSE 0 END +
          CASE WHEN f_unaccent(lower(psd.fitment_text)) LIKE f_unaccent(lower(${containsQuery})) THEN 200 ELSE 0 END +
          CASE WHEN f_unaccent(lower(psd.product_description)) LIKE f_unaccent(lower(${containsQuery})) THEN 80 ELSE 0 END +

          -- Full-text rank
          CASE
            WHEN psd.search_document @@ ${tsQuery}
            THEN ts_rank_cd(psd.search_document, ${tsQuery}) * 220
            ELSE 0
          END +

          -- Year-match boost (Phase C Q3=C)
          ${yearBoostExpr} +

          -- Trigram fuzzy (accent-insensitive)
          GREATEST(
            similarity(f_unaccent(lower(psd.product_code)), f_unaccent(lower(${normalizedQuery}))) * 420,
            similarity(f_unaccent(lower(psd.oem_text)), f_unaccent(lower(${normalizedQuery}))) * 380,
            similarity(f_unaccent(lower(psd.product_name)), f_unaccent(lower(${normalizedQuery}))) * 250,
            similarity(f_unaccent(lower(psd.keyword_text)), f_unaccent(lower(${normalizedQuery}))) * 180,
            similarity(f_unaccent(lower(psd.search_text)), f_unaccent(lower(${normalizedQuery}))) * 120
          )
        ) AS score
      FROM product_search_documents psd
      ${exactScope}
        ${isYearOnlyQuery ? Prisma.empty : Prisma.sql`AND (
          f_unaccent(lower(psd.product_code)) = f_unaccent(lower(${normalizedQuery}))
          OR f_unaccent(lower(psd.product_name)) = f_unaccent(lower(${normalizedQuery}))
          OR f_unaccent(lower(psd.product_code)) LIKE f_unaccent(lower(${prefixQuery}))
          OR f_unaccent(lower(psd.product_name)) LIKE f_unaccent(lower(${prefixQuery}))
          OR f_unaccent(lower(psd.oem_text)) LIKE f_unaccent(lower(${containsQuery}))
          OR f_unaccent(lower(psd.keyword_text)) LIKE f_unaccent(lower(${containsQuery}))
          OR f_unaccent(lower(psd.alias_text)) LIKE f_unaccent(lower(${containsQuery}))
          OR f_unaccent(lower(psd.search_text)) LIKE f_unaccent(lower(${containsQuery}))
          OR psd.search_document @@ ${tsQuery}
          OR similarity(f_unaccent(lower(psd.product_code)), f_unaccent(lower(${normalizedQuery}))) >= ${SEARCH_V2_CODE_SIMILARITY}
          OR similarity(f_unaccent(lower(psd.oem_text)), f_unaccent(lower(${normalizedQuery}))) >= ${SEARCH_V2_OEM_SIMILARITY}
          OR similarity(f_unaccent(lower(psd.product_name)), f_unaccent(lower(${normalizedQuery}))) >= ${SEARCH_V2_NAME_SIMILARITY}
          OR similarity(f_unaccent(lower(psd.search_text)), f_unaccent(lower(${normalizedQuery}))) >= ${SEARCH_V2_TEXT_SIMILARITY}
        )`}
    )
    SELECT
      ranked.product_id,
      ranked.match_code,
      ranked.match_oem,
      ranked.match_name,
      ranked.match_keyword,
      ranked.match_fitment,
      ranked.match_year,
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
    matchReasons: buildMatchReasons(rows),
  };
}

// ─── Phase Q4 — "Did you mean" suggestions ─────────────────────────────────

type DidYouMeanRow = { suggestion: string; score: number };

/**
 * Suggest up to 3 alternative search terms when the user query returns few
 * or no results. Pulls candidates from product names, ProductAlias.alias, and
 * SearchSynonym.term — ranks via trigram similarity (accent-insensitive).
 */
export async function suggestDidYouMean(
  rawQuery?: string | null,
  limit = 3,
): Promise<string[]> {
  const q = normalizeSearchQuery(rawQuery);
  if (!q || q.length < 2) return [];

  // Minimum trigram similarity for a suggestion to be useful
  const MIN_SIMILARITY = 0.25;

  try {
    const rows = await db.$queryRaw<DidYouMeanRow[]>(Prisma.sql`
      WITH candidates AS (
        SELECT name AS suggestion FROM "Product" WHERE "isActive" = true
        UNION ALL
        SELECT alias AS suggestion FROM "ProductAlias"
        UNION ALL
        SELECT term AS suggestion FROM "SearchSynonym" WHERE "isActive" = true
      ),
      scored AS (
        SELECT
          suggestion,
          similarity(f_unaccent(lower(suggestion)), f_unaccent(lower(${q}))) AS score
        FROM candidates
        WHERE suggestion <> ''
          AND length(suggestion) >= 2
          AND f_unaccent(lower(suggestion)) <> f_unaccent(lower(${q}))
      ),
      ranked AS (
        SELECT DISTINCT ON (lower(suggestion))
          suggestion,
          score
        FROM scored
        WHERE score >= ${MIN_SIMILARITY}
        ORDER BY lower(suggestion), score DESC
      )
      SELECT suggestion, score
      FROM ranked
      ORDER BY score DESC
      LIMIT ${limit}
    `);

    return rows.map((row) => row.suggestion);
  } catch (error) {
    console.error("suggestDidYouMean failed", error);
    return [];
  }
}

/** Convert RankedSearchRow booleans into productId → ProductMatchReason[]. */
const buildMatchReasons = (rows: RankedSearchRow[]): Record<string, ProductMatchReason[]> => {
  const map: Record<string, ProductMatchReason[]> = {};
  for (const row of rows) {
    const reasons: ProductMatchReason[] = [];
    if (row.match_code) reasons.push("code");
    if (row.match_oem) reasons.push("oem");
    if (row.match_year) reasons.push("year");
    if (row.match_fitment) reasons.push("fitment");
    if (row.match_keyword) reasons.push("keyword");
    if (row.match_name) reasons.push("name");
    map[row.product_id] = reasons;
  }
  return map;
};

export async function searchProductIds(
  input: ProductSearchInput,
): Promise<ProductSearchResult> {
  const cacheProfile = input.cacheProfile ?? "storefront";
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
    cacheProfile,
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
    {
      tags: [PRODUCT_SEARCH_TAG],
      revalidate: getProductSearchCacheTtl(cacheProfile),
    },
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
