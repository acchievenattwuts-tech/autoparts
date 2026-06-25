import { db, dbSearchRaw, dbSearchTx } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma";
import type { Product, Prisma as PrismaTypes } from "@/lib/generated/prisma";
import { unstable_cache } from "next/cache";
import {
  getProductSearchCacheTtl,
  PRODUCT_SEARCH_TAG,
  type ProductSearchCacheProfile,
} from "@/lib/product-search-cache";
import { expandQueryTokenGroups } from "@/lib/search-synonyms";
import { buildSearchVariants, normalizeSearchText } from "@/lib/search-normalization";
import { embedQuery, toPgVectorLiteral } from "@/lib/embeddings";

// Hybrid search (Phase 1): how many nearest-neighbour products to pull by vector
// similarity, and how much a perfect semantic match (cosine sim = 1) adds to the
// rank score. Kept below the exact-code (1500) / OEM (1400) / contains (600)
// weights so semantics enriches recall + ranking without overriding a strong
// textual/exact match.
const SEARCH_V2_VECTOR_RECALL_LIMIT = 100;
const SEARCH_V2_VECTOR_WEIGHT = 500;

/** A bare 1-2 digit number (e.g. the "2" in "Mazda 2"). Must NOT become a `:*`
 *  prefix lexeme — otherwise it matches every token starting with that digit
 *  (all 20xx model years in fitment text), exploding the result set. Matched as
 *  an exact lexeme instead so it still constrains to the model token. */
const SHORT_NUMBER_TOKEN_RE = /^\d{1,2}$/;

/** Sanitize one query token into a `to_tsquery` lexeme expression (Thai/alnum
 *  only). Short bare numbers stay exact; everything else gets prefix matching. */
const tokenToTsLexeme = (token: string): string | null => {
  const cleaned = token
    .replace(/[^\p{L}\p{M}\p{N}_-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned
    .split(" ")
    .map((word) => (SHORT_NUMBER_TOKEN_RE.test(word) ? word : `${word}:*`))
    .join(" & ");
};

/**
 * Builds the `to_tsquery` expression from grouped concept tokens.
 *  - mode "and": every concept must match (groups joined by &) — precise.
 *  - mode "or":  any concept may match (groups joined by |) — the recall fallback.
 * Within each group, synonyms are always OR'd. Returns "" when nothing usable.
 */
export const buildTsQueryExpression = (groups: string[][], mode: "and" | "or"): string => {
  const groupExpressions: string[] = [];
  for (const group of groups) {
    const lexemes = group
      .map(tokenToTsLexeme)
      .filter((expr): expr is string => Boolean(expr))
      .map((expr) => `(${expr})`);
    if (lexemes.length === 0) continue;
    groupExpressions.push(lexemes.join(" | "));
  }
  if (groupExpressions.length === 0) return "";
  const joiner = mode === "and" ? " & " : " | ";
  return groupExpressions.map((expr) => `(${expr})`).join(joiner);
};

const SEARCH_V2_CODE_SIMILARITY = 0.2;
const SEARCH_V2_NAME_SIMILARITY = 0.18;
const SEARCH_V2_TEXT_SIMILARITY = 0.12;
const SEARCH_V2_OEM_SIMILARITY = 0.2;

type ProductSearchOrder = "createdAtDesc" | "codeDesc";

type ProductSearchInput = {
  query?: string | null;
  isActive?: boolean;
  isStorefrontVisible?: boolean;
  categoryName?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  carBrandId?: string | null;
  carModelId?: string | null;
  carBrandName?: string | null;
  carModelName?: string | null;
  carModelNames?: string[] | null;
  requiredTokens?: string[] | null;
  /** Optional explicit fitment year filter (e.g. user selected from dropdown) */
  fitmentYear?: number | null;
  /** Multi-select storefront filters (Phase Filter-UI) */
  categoryNames?: string[] | null;
  brandIds?: string[] | null;
  carBrandNames?: string[] | null;
  /** Fitment year range — products with a fitment row overlapping [yearMin, yearMax] match */
  yearMin?: number | null;
  yearMax?: number | null;
  priceMin?: number | null;
  priceMax?: number | null;
  stockStatus?: "in_stock" | "low_stock" | "out_of_stock" | null;
  inventoryTracking?: "TRACKED" | "NON_TRACKED" | null;
  skip?: number;
  take?: number;
  order?: ProductSearchOrder;
  cacheProfile?: ProductSearchCacheProfile;
  /**
   * Skip the semantic (embedding) recall for this call and use lexical search only.
   * Used by the autocomplete endpoint for likely-bot traffic to save the per-query
   * Gemini embedding (latency + quota). Defaults to false — semantic stays on
   * everywhere else. Purely subtractive: lexical results are unchanged.
   */
  disableSemantic?: boolean;
  /**
   * Skip the broad OR recall retry when the precise AND query returns no rows.
   * Used by high-frequency/lightweight callers that should not spend extra DB
   * work on every keystroke; full search keeps the retry by default.
   */
  disableBroadFallback?: boolean;
};

const normalizeStringArray = (values?: string[] | null): string[] =>
  Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));

const normalizeRequiredTokens = (values?: string[] | null): string[] =>
  Array.from(new Set((values ?? []).map((value) => normalizeSearchText(value)).filter(Boolean)));

const normalizeYearBound = (value?: number | null): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 1900 || value > 2200) return null;
  return Math.trunc(value);
};

const normalizePriceBound = (value?: number | null): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
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
  match_code?: boolean | null;
  match_oem?: boolean | null;
  match_name?: boolean | null;
};

const normalizeSearchQuery = (query?: string | null): string | undefined => {
  const normalized = normalizeSearchText(query);
  return normalized ? normalized : undefined;
};

/**
 * Auto-detect a 4-digit model year (1900-2200) in the user query.
 *
 * Only treats a 4-digit number as a year when it stands alone as a
 * whitespace-delimited token (e.g. "Vios 2010"). A number glued into a
 * part-number / code token (e.g. "446610-1950", "EVISC-D1446610-1950") is NOT
 * a year — otherwise the fitment-year filter would wrongly exclude that part.
 */
export const extractYearFromQuery = (query?: string | null): number | null => {
  if (!query) return null;
  for (const token of query.split(/\s+/)) {
    if (!/^(19|20|21)\d{2}$/.test(token)) continue;
    const y = parseInt(token, 10);
    if (y >= 1900 && y <= 2200) return y;
  }
  return null;
};

type InferredTwoDigitYear = {
  year: number;
  sourceToken: string;
};

const twoDigitYearToFullYear = (token: string): number | null => {
  if (!/^\d{2}$/.test(token)) return null;
  const value = Number(token);
  if (value <= 35) return 2000 + value;
  if (value >= 80) return 1900 + value;
  return null;
};

export const inferTwoDigitYearFromQueryWithVehicleEvidence = (
  query: string | null | undefined,
  vehicleEvidenceTerms: string[],
): InferredTwoDigitYear | null => {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return null;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  const sourceToken = tokens[tokens.length - 1];
  const year = twoDigitYearToFullYear(sourceToken);
  if (year === null) return null;

  const evidenceSet = new Set(vehicleEvidenceTerms.map(normalizeSearchText).filter(Boolean));
  if (evidenceSet.size === 0) return null;

  const queryTerms = tokens.slice(0, -1);
  const hasVehicleEvidence = queryTerms.some((term) =>
    buildSearchVariants(term).some((variant) => evidenceSet.has(variant)),
  );

  return hasVehicleEvidence ? { year, sourceToken } : null;
};

const getVehicleEvidenceTermsForTwoDigitYear = async (
  normalizedQuery: string,
): Promise<string[]> => {
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const sourceToken = tokens[tokens.length - 1];
  if (tokens.length < 2 || twoDigitYearToFullYear(sourceToken) === null) return [];

  const evidenceCandidates = Array.from(
    new Set(
      tokens
        .slice(0, -1)
        .flatMap((token) => buildSearchVariants(token))
        .map(normalizeSearchText)
        .filter((token) => token.length >= 2),
    ),
  );
  if (evidenceCandidates.length === 0) return [];

  const rows = await dbSearchRaw<Array<{ term: string }>>(Prisma.sql`
    SELECT term
    FROM (
      ${Prisma.join(
        evidenceCandidates.map((term) => Prisma.sql`SELECT ${term}::text AS term`),
        " UNION ALL ",
      )}
    ) AS candidate_terms
    WHERE EXISTS (
      SELECT 1
      FROM product_search_documents psd
      WHERE f_unaccent(lower(psd.car_model_text)) LIKE f_unaccent(lower('%' || candidate_terms.term || '%'))
         OR f_unaccent(lower(psd.car_brand_text)) LIKE f_unaccent(lower('%' || candidate_terms.term || '%'))
    )
  `);

  return rows.map((row) => row.term);
};

const resolveQueryYear = async (
  normalizedQuery?: string | null,
  explicitFitmentYear?: number | null,
): Promise<{ year: number | null; sourceToken: string | null }> => {
  if (typeof explicitFitmentYear === "number") {
    return { year: explicitFitmentYear, sourceToken: String(explicitFitmentYear) };
  }

  const fourDigitYear = extractYearFromQuery(normalizedQuery);
  if (fourDigitYear !== null) {
    return { year: fourDigitYear, sourceToken: String(fourDigitYear) };
  }

  if (!normalizedQuery) return { year: null, sourceToken: null };

  const vehicleEvidenceTerms = await getVehicleEvidenceTermsForTwoDigitYear(normalizedQuery);
  const inferred = inferTwoDigitYearFromQueryWithVehicleEvidence(
    normalizedQuery,
    vehicleEvidenceTerms,
  );
  return inferred
    ? { year: inferred.year, sourceToken: inferred.sourceToken }
    : { year: null, sourceToken: null };
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
    {
      carModels: {
        some: {
          submodel: { contains: query, mode: "insensitive" },
        },
      },
    },
    {
      carModels: {
        some: {
          engineCode: { contains: query, mode: "insensitive" },
        },
      },
    },
    {
      carModels: {
        some: {
          engineSize: { contains: query, mode: "insensitive" },
        },
      },
    },
    {
      carModels: {
        some: {
          note: { contains: query, mode: "insensitive" },
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

const buildProductFilterWhere = (
  input: Pick<
    ProductSearchInput,
    | "query"
    | "isActive"
    | "isStorefrontVisible"
    | "categoryName"
    | "categoryId"
    | "brandId"
    | "carBrandId"
    | "carModelId"
    | "carBrandName"
    | "carModelName"
    | "carModelNames"
    | "requiredTokens"
    | "categoryNames"
    | "brandIds"
    | "carBrandNames"
    | "priceMin"
    | "priceMax"
    | "stockStatus"
    | "inventoryTracking"
  >,
): PrismaTypes.ProductWhereInput => {
  const {
    query,
    isActive,
    isStorefrontVisible,
    categoryName,
    categoryId,
    brandId,
    carBrandId,
    carModelId,
    carBrandName,
    carModelNames,
    carModelName,
  } = input;
  const where: PrismaTypes.ProductWhereInput = {};
  const searchWhere = buildProductSearchWhere(query);
  const normalizedCarModelNames = normalizeCarModelNames({ carModelName, carModelNames });
  const requiredTokens = normalizeRequiredTokens(input.requiredTokens);
  const normalizedCategoryNames = normalizeStringArray(input.categoryNames);
  const normalizedBrandIds = normalizeStringArray(input.brandIds);
  const normalizedCarBrandNames = normalizeStringArray(input.carBrandNames);
  const priceMin = normalizePriceBound(input.priceMin);
  const priceMax = normalizePriceBound(input.priceMax);

  if (typeof isActive === "boolean") {
    where.isActive = isActive;
  }
  if (typeof isStorefrontVisible === "boolean") {
    where.isStorefrontVisible = isStorefrontVisible;
  }

  if (categoryName) {
    where.category = { name: categoryName };
  } else if (normalizedCategoryNames.length > 0) {
    where.category = { name: { in: normalizedCategoryNames } };
  }

  if (categoryId) {
    where.categoryId = categoryId;
  }

  if (brandId) {
    where.brandId = brandId;
  } else if (normalizedBrandIds.length > 0) {
    where.brandId = { in: normalizedBrandIds };
  }

  if (priceMin !== null || priceMax !== null) {
    const priceFilter: PrismaTypes.DecimalFilter = {};
    if (priceMin !== null) priceFilter.gte = priceMin;
    if (priceMax !== null) priceFilter.lte = priceMax;
    where.salePrice = priceFilter;
  }

  if (input.stockStatus === "out_of_stock") {
    where.stock = { lte: 0 };
  }

  if (input.inventoryTracking === "TRACKED" || input.inventoryTracking === "NON_TRACKED") {
    where.inventoryTracking = input.inventoryTracking;
  }

  const effectiveCarBrandNames = carBrandName
    ? [carBrandName]
    : normalizedCarBrandNames;

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
  } else if (effectiveCarBrandNames.length > 0 && normalizedCarModelNames.length > 0) {
    where.carModels = {
      some: {
        carModel: {
          name: { in: normalizedCarModelNames },
          carBrand: { name: { in: effectiveCarBrandNames } },
        },
      },
    };
  } else if (effectiveCarBrandNames.length > 0) {
    where.carModels = {
      some: {
        carModel: {
          carBrand: { name: { in: effectiveCarBrandNames } },
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
    return applyRequiredTokenFilter(where, requiredTokens);
  }

  return {
    AND: [applyRequiredTokenFilter(where, requiredTokens), searchWhere],
  };
};

const buildRequiredTokenCondition = (token: string): PrismaTypes.ProductWhereInput => ({
  OR: [
    { name: { contains: token, mode: "insensitive" } },
    { code: { contains: token, mode: "insensitive" } },
    { description: { contains: token, mode: "insensitive" } },
    { aliases: { some: { alias: { contains: token, mode: "insensitive" } } } },
    {
      carModels: {
        some: {
          OR: [
            { submodel: { contains: token, mode: "insensitive" } },
            { engineCode: { contains: token, mode: "insensitive" } },
            { engineSize: { contains: token, mode: "insensitive" } },
            { note: { contains: token, mode: "insensitive" } },
            { carModel: { name: { contains: token, mode: "insensitive" } } },
            { carModel: { carBrand: { name: { contains: token, mode: "insensitive" } } } },
          ],
        },
      },
    },
    { category: { name: { contains: token, mode: "insensitive" } } },
    { brand: { name: { contains: token, mode: "insensitive" } } },
  ],
});

const applyRequiredTokenFilter = (
  where: PrismaTypes.ProductWhereInput,
  requiredTokens: string[],
): PrismaTypes.ProductWhereInput => {
  if (requiredTokens.length === 0) return where;
  const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
  return {
    ...where,
    AND: [
      ...existingAnd,
      ...requiredTokens.map((token) => buildRequiredTokenCondition(token)),
    ],
  };
};

/**
 * Build a year-aware filter for the Prisma fallback path.
 * Supports both the legacy single-year API (`targetYear`) and the storefront range
 * filter (`yearMin`/`yearMax`). A fitment row matches if its [yearStart,yearEnd]
 * overlaps the requested range; lenient — NULL fitment bounds are treated as open.
 */
const buildYearOrConditions = (
  year: number,
): PrismaTypes.ProductFitmentWhereInput[] => [
  { yearStart: null, yearEnd: null },
  { yearStart: null, yearEnd: { gte: year } },
  { yearEnd: null, yearStart: { lte: year } },
  {
    AND: [
      { yearStart: { lte: year } },
      { yearEnd: { gte: year } },
    ],
  },
];

const buildYearRangeOverlap = (
  yearMin: number | null,
  yearMax: number | null,
): PrismaTypes.ProductFitmentWhereInput => {
  const ands: PrismaTypes.ProductFitmentWhereInput[] = [];
  if (yearMax !== null) {
    ands.push({ OR: [{ yearStart: null }, { yearStart: { lte: yearMax } }] });
  }
  if (yearMin !== null) {
    ands.push({ OR: [{ yearEnd: null }, { yearEnd: { gte: yearMin } }] });
  }
  return ands.length === 1 ? ands[0] : { AND: ands };
};

const applyYearFilter = (
  where: PrismaTypes.ProductWhereInput,
  targetYear: number | null,
  yearMin: number | null = null,
  yearMax: number | null = null,
): PrismaTypes.ProductWhereInput => {
  const yearConditions: PrismaTypes.ProductFitmentWhereInput[] = [];

  if (targetYear !== null) {
    yearConditions.push({ OR: buildYearOrConditions(targetYear) });
  }

  if (yearMin !== null || yearMax !== null) {
    yearConditions.push(buildYearRangeOverlap(yearMin, yearMax));
  }

  if (yearConditions.length === 0) return where;

  const yearCondition: PrismaTypes.ProductWhereInput = {
    carModels: {
      some: yearConditions.length === 1 ? yearConditions[0] : { AND: yearConditions },
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
  const { year: targetYear } = await resolveQueryYear(input.query, input.fitmentYear);
  const yearMin = normalizeYearBound(input.yearMin);
  const yearMax = normalizeYearBound(input.yearMax);
  const where = applyYearFilter(baseWhere, targetYear, yearMin, yearMax);

  if (input.stockStatus === "in_stock" || input.stockStatus === "low_stock") {
    const stockRows = await db.$queryRaw<{ id: string }[]>(
      input.stockStatus === "in_stock"
        ? Prisma.sql`SELECT id FROM "Product" WHERE stock > "minStock"`
        : Prisma.sql`SELECT id FROM "Product" WHERE stock > 0 AND stock <= "minStock"`,
    );
    const stockIds = stockRows.map((r) => r.id);
    where.id = { in: stockIds.length > 0 ? stockIds : ["__no-stock__"] };
  }
  const skip = input.skip ?? 0;
  const take = input.take ?? 30;
  const order = input.order ?? "createdAtDesc";

  const rows = await db.product.findMany({
    where,
    select: { id: true },
    orderBy: getFallbackOrderBy(order),
    skip,
    take,
  });
  const total = await db.product.count({ where });

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
  const requiredTokens = normalizeRequiredTokens(input.requiredTokens);

  if (!normalizedQuery) {
    return searchProductIdsFallback(input);
  }

  const skip = input.skip ?? 0;
  const take = input.take ?? 30;
  const prefixQuery = `${normalizedQuery}%`;
  const containsQuery = `%${normalizedQuery}%`;

  // Year resolution (which may issue its own vehicle-evidence query) and synonym
  // token expansion are independent of each other, so run them in parallel to
  // avoid a serial roundtrip before the main search on cache misses.
  //  - resolveQueryYear: explicit `fitmentYear` from UI, else auto-detect from query
  //  - expandQueryTokenGroups: Phase D + AND-scope — expand the query into
  //    per-concept synonym groups, then build a precise AND-across-concepts
  //    tsquery ("หม้อน้ำ" & "mazda" & "2") with a broad OR query kept as the recall
  //    fallback. Sanitization into simple lexemes (Thai/alnum only) means user
  //    input can never inject tsquery syntax.
  const [{ year: targetYear, sourceToken: targetYearSourceToken }, tokenGroups] =
    await Promise.all([
      resolveQueryYear(normalizedQuery, input.fitmentYear),
      expandQueryTokenGroups(normalizedQuery),
    ]);

  // Drop the detected model-year token from the FTS clause: the year is enforced
  // separately by yearFilterClause / yearBoost against the fitment range, so
  // requiring it as a literal lexeme would wrongly exclude products whose fitment
  // is stored as a range (e.g. "2008-2012" has no standalone "2010" token).
  const ftsGroups =
    targetYear !== null
      ? tokenGroups.filter(
          (group) =>
            !(
              group.length === 1 &&
              (group[0] === String(targetYear) || group[0] === targetYearSourceToken)
            ),
        )
      : tokenGroups;

  const andExpression = buildTsQueryExpression(ftsGroups, "and");
  const orExpression = buildTsQueryExpression(ftsGroups, "or");
  const safeFallbackExpression =
    normalizedQuery.replace(/[^\p{L}\p{M}\p{N}_-]+/gu, " ").trim() || normalizedQuery;

  // Primary = AND (precise); OR fallback only matters when ≥2 concepts exist.
  const primaryExpression = andExpression || orExpression || safeFallbackExpression;
  const fallbackExpression = orExpression || safeFallbackExpression;
  const hasMultipleConcepts = ftsGroups.length > 1 && fallbackExpression !== primaryExpression;

  // Phase Q2: pass query through f_unaccent so it matches the unaccented tsvector index.
  const buildTsQuery = (expression: string) =>
    Prisma.sql`to_tsquery('simple', f_unaccent(${expression}))`;
  const tsQuery = buildTsQuery(primaryExpression);

  // When the user types a pure 4-digit year (e.g. "1901"), the fitment_text
  // stores ranges as literal "1900-1904" so substring/FTS won't match interior
  // years. Skip the AND text-match clause and rely solely on the yearFilter
  // (already enforced via exactScope) — yearBoost gives score > 0 so results
  // still pass the ranked.score > 0 cut.
  const isYearOnlyQuery = targetYear !== null && /^\d{4}$/.test(normalizedQuery);

  // Year filter:
  //  - Mixed query (e.g. "ผ้าเบรค Vios 2010"): lenient hard AND — also accept
  //    NULL/NULL because the text-match clause already constrains the set.
  //  - Year-only query (e.g. "1950"): do NOT hard-filter by year. A bare 4-digit
  //    number is often a part-number fragment, so the year becomes one of
  //    several OR candidate paths below (see yearOnlyFitmentExists) and
  //    yearBoost still ranks true year matches highest.
  const yearFilterClause = targetYear !== null && !isYearOnlyQuery
    ? Prisma.sql`
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

  // For year-only queries: an explicit fitment-year cover is one acceptable
  // candidate path, UNIONed with the text/code/oem clause below (so a 4-digit
  // part-number fragment like "1950" still matches via product_code/oem/text).
  const yearOnlyFitmentExists = targetYear !== null && isYearOnlyQuery
    ? Prisma.sql`
        EXISTS (
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
  const storefrontVisibleClause =
    typeof input.isStorefrontVisible === "boolean"
      ? Prisma.sql`
          AND EXISTS (
            SELECT 1
            FROM "Product" p
            WHERE p.id = psd.product_id
              AND p."isStorefrontVisible" = ${input.isStorefrontVisible}
          )
        `
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

  const normalizedCategoryNames = normalizeStringArray(input.categoryNames);
  const normalizedBrandIds = normalizeStringArray(input.brandIds);
  const normalizedCarBrandNames = normalizeStringArray(input.carBrandNames);
  const yearMinRange = normalizeYearBound(input.yearMin);
  const yearMaxRange = normalizeYearBound(input.yearMax);
  const priceMin = normalizePriceBound(input.priceMin);
  const priceMax = normalizePriceBound(input.priceMax);
  const effectiveCarBrandNames = input.carBrandName
    ? [input.carBrandName]
    : normalizedCarBrandNames;

  const carBrandClause = effectiveCarBrandNames.length > 0
    ? Prisma.sql`
        AND EXISTS (
          SELECT 1
          FROM "ProductCarModel" pcm
          INNER JOIN "CarModel" cm ON cm.id = pcm."carModelId"
          INNER JOIN "CarBrand" cb ON cb.id = cm."carBrandId"
          WHERE pcm."productId" = psd.product_id
            AND cb.name IN (${Prisma.join(effectiveCarBrandNames)})
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

  // Multi-select category (storefront filter UI)
  const categoryNamesClause = !input.categoryName && normalizedCategoryNames.length > 0
    ? Prisma.sql`AND psd.category_name IN (${Prisma.join(normalizedCategoryNames)})`
    : Prisma.empty;

  // Multi-select parts brand
  const brandIdsClause = !input.brandId && normalizedBrandIds.length > 0
    ? Prisma.sql`
        AND EXISTS (
          SELECT 1
          FROM "Product" p
          WHERE p.id = psd.product_id
            AND p."brandId" IN (${Prisma.join(normalizedBrandIds)})
        )
      `
    : Prisma.empty;

  // Year range overlap — fitment row [yearStart,yearEnd] intersects [yearMin,yearMax].
  // NULL fitment bounds are open-ended (lenient).
  const yearRangeClause = (yearMinRange !== null || yearMaxRange !== null)
    ? Prisma.sql`
        AND EXISTS (
          SELECT 1
          FROM "ProductCarModel" pcm
          WHERE pcm."productId" = psd.product_id
            AND ${yearMaxRange !== null
              ? Prisma.sql`(pcm."yearStart" IS NULL OR pcm."yearStart" <= ${yearMaxRange})`
              : Prisma.sql`TRUE`}
            AND ${yearMinRange !== null
              ? Prisma.sql`(pcm."yearEnd" IS NULL OR pcm."yearEnd" >= ${yearMinRange})`
              : Prisma.sql`TRUE`}
        )
      `
    : Prisma.empty;

  // Price range (Decimal salePrice on Product)
  const priceMinClause = priceMin !== null
    ? Prisma.sql`
        AND EXISTS (
          SELECT 1 FROM "Product" p
          WHERE p.id = psd.product_id AND p."salePrice" >= ${priceMin}
        )
      `
    : Prisma.empty;
  const priceMaxClause = priceMax !== null
    ? Prisma.sql`
        AND EXISTS (
          SELECT 1 FROM "Product" p
          WHERE p.id = psd.product_id AND p."salePrice" <= ${priceMax}
        )
      `
    : Prisma.empty;

  const stockStatusClause = input.stockStatus === "out_of_stock"
    ? Prisma.sql`AND EXISTS (SELECT 1 FROM "Product" p WHERE p.id = psd.product_id AND p.stock <= 0)`
    : input.stockStatus === "in_stock"
    ? Prisma.sql`AND EXISTS (SELECT 1 FROM "Product" p WHERE p.id = psd.product_id AND p.stock > p."minStock")`
    : input.stockStatus === "low_stock"
    ? Prisma.sql`AND EXISTS (SELECT 1 FROM "Product" p WHERE p.id = psd.product_id AND p.stock > 0 AND p.stock <= p."minStock")`
    : Prisma.empty;

  const inventoryTrackingClause =
    input.inventoryTracking === "TRACKED" || input.inventoryTracking === "NON_TRACKED"
      ? Prisma.sql`
          AND EXISTS (
            SELECT 1 FROM "Product" p
            WHERE p.id = psd.product_id
              AND p."inventoryTracking" = ${input.inventoryTracking}::"InventoryTracking"
          )
        `
      : Prisma.empty;

  const requiredTokensClause = requiredTokens.length > 0
    ? Prisma.sql`
        AND ${Prisma.join(
          requiredTokens.map((token) => {
            const containsToken = `%${token}%`;
            return Prisma.sql`(
              f_unaccent(lower(psd.product_code)) LIKE f_unaccent(lower(${containsToken}))
              OR f_unaccent(lower(psd.product_name)) LIKE f_unaccent(lower(${containsToken}))
              OR f_unaccent(lower(psd.product_description)) LIKE f_unaccent(lower(${containsToken}))
              OR f_unaccent(lower(psd.oem_text)) LIKE f_unaccent(lower(${containsToken}))
              OR f_unaccent(lower(psd.keyword_text)) LIKE f_unaccent(lower(${containsToken}))
              OR f_unaccent(lower(psd.alias_text)) LIKE f_unaccent(lower(${containsToken}))
              OR f_unaccent(lower(psd.fitment_text)) LIKE f_unaccent(lower(${containsToken}))
              OR f_unaccent(lower(psd.search_text)) LIKE f_unaccent(lower(${containsToken}))
            )`;
          }),
          " AND ",
        )}
      `
    : Prisma.empty;

  const exactScope = Prisma.sql`
    WHERE TRUE
      ${isActiveClause}
      ${storefrontVisibleClause}
      ${categoryClause}
      ${categoryNamesClause}
      ${categoryIdClause}
      ${brandIdClause}
      ${brandIdsClause}
      ${carBrandIdClause}
      ${carModelIdClause}
      ${carBrandClause}
      ${carModelClause}
      ${yearFilterClause}
      ${yearRangeClause}
      ${priceMinClause}
      ${priceMaxClause}
      ${stockStatusClause}
      ${inventoryTrackingClause}
      ${requiredTokensClause}
  `;

  const exactRows = await dbSearchRaw<ExactSearchRow[]>(Prisma.sql`
    WITH exact_matches AS (
      SELECT
        psd.product_id,
        psd.product_created_at,
        (
          f_unaccent(lower(psd.product_code)) = f_unaccent(lower(${normalizedQuery}))
        ) AS match_code,
        (
          f_unaccent(psd.oem_text) ILIKE f_unaccent(${`%${normalizedQuery}%`})
          AND EXISTS (
            SELECT 1 FROM regexp_split_to_table(psd.oem_text, '\s+') AS tok(tok)
            WHERE f_unaccent(lower(tok.tok)) = f_unaccent(lower(${normalizedQuery}))
          )
        ) AS match_oem,
        (
          f_unaccent(lower(psd.product_name)) = f_unaccent(lower(${normalizedQuery}))
        ) AS match_name
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
          OR f_unaccent(lower(psd.product_name)) = f_unaccent(lower(${normalizedQuery}))
        )
    ),
    selected AS (
      SELECT
        exact_matches.*,
        bool_or(COALESCE(match_code, false) OR COALESCE(match_oem, false)) OVER() AS has_code_or_oem
      FROM exact_matches
    )
    SELECT
      selected.product_id,
      selected.match_code,
      selected.match_oem,
      selected.match_name,
      COUNT(*) OVER() AS total_count
    FROM selected
    WHERE (
      COALESCE(selected.has_code_or_oem, false)
      AND (COALESCE(selected.match_code, false) OR COALESCE(selected.match_oem, false))
    ) OR (
      NOT COALESCE(selected.has_code_or_oem, false)
      AND COALESCE(selected.match_name, false)
    )
    ORDER BY selected.product_created_at DESC, selected.product_id DESC
    OFFSET ${skip}
    LIMIT ${take}
  `);

  if (exactRows.length > 0) {
    const reasons: Record<string, ProductMatchReason[]> = {};
    const hasCodeOrOem = exactRows.some((row) => row.match_code || row.match_oem);
    for (const row of exactRows) {
      if (hasCodeOrOem) {
        // Preserve the former exact-code/OEM branch attribution.
        reasons[row.product_id] = /[-0-9]/.test(normalizedQuery) ? ["code", "oem"] : ["code"];
      } else {
        reasons[row.product_id] = ["name"];
      }
    }
    return {
      ids: exactRows.map((row) => row.product_id),
      total: coerceCount(exactRows[0].total_count),
      mode: "v2",
      matchReasons: reasons,
    };
  }

  // Semantic recall (Phase 1, gated). When enabled, pull the nearest products by
  // embedding cosine distance under the SAME hard filters (exactScope), to inject
  // as extra candidates + a rank boost in the ranked query below. Skipped for
  // year-only queries, and any failure (keys exhausted, extension missing, flag
  // off) degrades to pure lexical search — so this is purely additive.
  //
  // The embedding is fetched here (a Gemini network call) BEFORE any DB
  // transaction is opened, so no pooled connection is ever held while waiting on
  // the external API. The actual vector query runs inside the bundled
  // transaction below (see dbSearchTx) so it shares one connection with the
  // ranked query.
  const queryEmbedding =
    isYearOnlyQuery || input.disableSemantic ? null : await embedQuery(normalizedQuery);

  const vectorRecallSql = (qvec: string): PrismaTypes.Sql => Prisma.sql`
    SELECT psd.product_id, (1 - (psd.embedding <=> ${qvec}::vector))::float8 AS sim
    FROM product_search_documents psd
    ${exactScope}
      AND psd.embedding IS NOT NULL
    ORDER BY psd.embedding <=> ${qvec}::vector
    LIMIT ${SEARCH_V2_VECTOR_RECALL_LIMIT}
  `;

  type VectorMatch = { product_id: string; sim: number };
  type VectorFragments = {
    vectorCte: PrismaTypes.Sql;
    vectorJoin: PrismaTypes.Sql;
    vectorCandidate: PrismaTypes.Sql;
    vectorScore: PrismaTypes.Sql;
  };
  // Vector-derived SQL fragments depend on the recalled matches, so they are
  // rebuilt from whatever the (possibly-failed) vector query returned. With zero
  // matches every fragment is empty and the ranked query is byte-identical to the
  // lexical-only form.
  const buildVectorFragments = (vectorMatches: VectorMatch[]): VectorFragments => {
    const hasVector = vectorMatches.length > 0;
    return {
      vectorCte: hasVector
        ? Prisma.sql`vec(product_id, sim) AS (VALUES ${Prisma.join(
            vectorMatches.map((m) => Prisma.sql`(${m.product_id}::text, ${m.sim}::float8)`),
          )}),`
        : Prisma.empty,
      vectorJoin: hasVector
        ? Prisma.sql`LEFT JOIN vec v ON v.product_id = psd.product_id`
        : Prisma.empty,
      vectorCandidate: hasVector ? Prisma.sql`OR v.product_id IS NOT NULL` : Prisma.empty,
      vectorScore: hasVector
        ? Prisma.sql`+ COALESCE(v.sim, 0) * ${SEARCH_V2_VECTOR_WEIGHT}`
        : Prisma.empty,
    };
  };

  // Candidate-selection OR clause (shared by year-only and non-year queries).
  // A product enters the ranked set if it matches the query by code/name/oem/
  // keyword/alias/free-text/FTS/trigram, OR by semantic similarity (vector). The
  // FTS clause (`@@ tsQuery`) is the only term that varies between the precise AND
  // query and the OR recall fallback.
  const buildTextMatchOr = (ts: PrismaTypes.Sql) => Prisma.sql`
    f_unaccent(lower(psd.product_code)) = f_unaccent(lower(${normalizedQuery}))
    OR f_unaccent(lower(psd.product_name)) = f_unaccent(lower(${normalizedQuery}))
    OR f_unaccent(lower(psd.product_code)) LIKE f_unaccent(lower(${prefixQuery}))
    OR f_unaccent(lower(psd.product_name)) LIKE f_unaccent(lower(${prefixQuery}))
    OR f_unaccent(lower(psd.oem_text)) LIKE f_unaccent(lower(${containsQuery}))
    OR f_unaccent(lower(psd.keyword_text)) LIKE f_unaccent(lower(${containsQuery}))
    OR f_unaccent(lower(psd.alias_text)) LIKE f_unaccent(lower(${containsQuery}))
    OR f_unaccent(lower(psd.search_text)) LIKE f_unaccent(lower(${containsQuery}))
    OR psd.search_document @@ ${ts}
    OR similarity(f_unaccent(lower(psd.product_code)), f_unaccent(lower(${normalizedQuery}))) >= ${SEARCH_V2_CODE_SIMILARITY}
    OR similarity(f_unaccent(lower(psd.oem_text)), f_unaccent(lower(${normalizedQuery}))) >= ${SEARCH_V2_OEM_SIMILARITY}
    OR similarity(f_unaccent(lower(psd.product_name)), f_unaccent(lower(${normalizedQuery}))) >= ${SEARCH_V2_NAME_SIMILARITY}
    OR similarity(f_unaccent(lower(psd.search_text)), f_unaccent(lower(${normalizedQuery}))) >= ${SEARCH_V2_TEXT_SIMILARITY}
  `;

  const runRankedQuery = (
    ts: PrismaTypes.Sql,
    frags: VectorFragments,
    run: <R>(query: PrismaTypes.Sql) => Promise<R>,
    rangeSkip: number = skip,
    rangeTake: number = take,
  ) => {
    const textMatchOr = buildTextMatchOr(ts);
    // Year-only queries union the text clause with a fitment-year cover so they
    // match BOTH part-number fragments and products fitting that year.
    const candidateClause = isYearOnlyQuery
      ? Prisma.sql`AND (${textMatchOr} OR ${yearOnlyFitmentExists} ${frags.vectorCandidate})`
      : Prisma.sql`AND (${textMatchOr} ${frags.vectorCandidate})`;

    return run<RankedSearchRow[]>(Prisma.sql`
    WITH ${frags.vectorCte} ranked AS (
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
            WHEN psd.search_document @@ ${ts}
            THEN ts_rank_cd(psd.search_document, ${ts}) * 220
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
          ) +

          -- Phase Q7: popularity / availability tie-breakers. Kept far below the
          -- exact (1500) / OEM (1400) / contains (600) weights so a best-seller
          -- or in-stock item only outranks an *otherwise equally relevant* one —
          -- it can never push a weak match above a strong textual match.
          CASE WHEN psd.stock > 0 THEN 60 ELSE 0 END +
          LEAST(psd.sales_count, 100) * 1.2

          -- Semantic similarity boost (Phase 1 hybrid). Empty when vector recall
          -- is unavailable/disabled, so the score is identical to lexical-only.
          ${frags.vectorScore}
        ) AS score
      FROM product_search_documents psd
      ${frags.vectorJoin}
      ${exactScope}
        ${candidateClause}
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
    OFFSET ${rangeSkip}
    LIMIT ${rangeTake}
  `);
  };

  // Precise AND query first. If a multi-concept query comes back empty (AND was
  // too strict for this catalog's wording), fall back to the broad OR query so we
  // never regress to "no results" where the old OR behaviour would have matched.
  //
  // Bundle the semantic recall + primary ranked query into ONE transaction so the
  // whole post-embedding DB work checks out a single pooled connection instead of
  // one per query — cutting the connection churn that was exhausting the small
  // pool and surfacing as P2028. The vector recall is wrapped in a SAVEPOINT: if
  // it times out (8s statement cap) or fails, we roll back just that savepoint and
  // continue with lexical-only ranking in the SAME transaction, preserving the
  // previous "semantic failure degrades to lexical" behaviour instead of poisoning
  // the whole transaction.
  const { vectorMatches, primaryRows } = await dbSearchTx(async (tx) => {
    const run = <R>(query: PrismaTypes.Sql): Promise<R> => tx.$queryRaw<R>(query);

    let vectorMatches: VectorMatch[] = [];
    if (queryEmbedding) {
      try {
        await tx.$executeRawUnsafe("SAVEPOINT vec_recall");
        const qvec = toPgVectorLiteral(queryEmbedding);
        vectorMatches = await run<VectorMatch[]>(vectorRecallSql(qvec));
        await tx.$executeRawUnsafe("RELEASE SAVEPOINT vec_recall");
      } catch (error) {
        console.error("Semantic recall failed; falling back to lexical-only search.", error);
        try {
          // Recover the transaction so the lexical ranked query below can run.
          await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT vec_recall");
        } catch {
          // Savepoint may not exist if the SAVEPOINT statement itself failed; if
          // the transaction is unrecoverable the ranked query will throw and the
          // caller degrades to the Prisma fallback — never worse than before.
        }
        vectorMatches = [];
      }
    }

    const frags = buildVectorFragments(vectorMatches);
    const primaryRows = await runRankedQuery(tsQuery, frags, run);
    return { vectorMatches, primaryRows };
  });

  let rows = primaryRows;
  if (rows.length === 0 && hasMultipleConcepts && !input.disableBroadFallback) {
    // Rare path (precise AND matched nothing): reuse the already-recalled vector
    // matches and run the broad OR query in its own short transaction.
    rows = await runRankedQuery(
      buildTsQuery(fallbackExpression),
      buildVectorFragments(vectorMatches),
      dbSearchRaw,
    );
  }

  // `total` comes from COUNT(*) OVER() on the returned rows. A deep OFFSET can
  // slice away every row even when matches exist (e.g. a stale/out-of-range page
  // link), which would otherwise report total=0 and collapse pagination. When the
  // page is empty but skip > 0, re-probe the first row (skip=0, take=1) to recover
  // the real total. This extra query fires only on the rare out-of-range case.
  let total = rows.length > 0 ? coerceCount(rows[0].total_count) : 0;
  if (rows.length === 0 && skip > 0) {
    const vectorFrags = buildVectorFragments(vectorMatches);
    const probePrimary = await runRankedQuery(tsQuery, vectorFrags, dbSearchRaw, 0, 1);
    if (probePrimary.length > 0) {
      total = coerceCount(probePrimary[0].total_count);
    } else if (hasMultipleConcepts && !input.disableBroadFallback) {
      const probeFallback = await runRankedQuery(
        buildTsQuery(fallbackExpression),
        vectorFrags,
        dbSearchRaw,
        0,
        1,
      );
      if (probeFallback.length > 0) {
        total = coerceCount(probeFallback[0].total_count);
      }
    }
  }

  return {
    ids: rows.map((row) => row.product_id),
    total,
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

  try {
    // Each candidate source is pre-filtered with the pg_trgm `%` operator so the
    // GIN trigram indexes (Phase Q6) drive an index scan instead of a full-table
    // similarity() pass. `%` uses pg_trgm.similarity_threshold (default 0.3);
    // similarity() is then computed only on the small matched set for ranking.
    const rows = await dbSearchRaw<DidYouMeanRow[]>(Prisma.sql`
      WITH candidates AS (
        SELECT name AS suggestion FROM "Product"
          WHERE "isActive" = true
            AND f_unaccent(lower(name)) % f_unaccent(lower(${q}))
        UNION ALL
        SELECT alias AS suggestion FROM "ProductAlias"
          WHERE f_unaccent(lower(alias)) % f_unaccent(lower(${q}))
        UNION ALL
        SELECT term AS suggestion FROM "SearchSynonym"
          WHERE "isActive" = true
            AND f_unaccent(lower(term)) % f_unaccent(lower(${q}))
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
    isStorefrontVisible: input.isStorefrontVisible ?? null,
    categoryName: input.categoryName ?? "",
    categoryId: input.categoryId ?? "",
    brandId: input.brandId ?? "",
    carBrandId: input.carBrandId ?? "",
    carModelId: input.carModelId ?? "",
    carBrandName: input.carBrandName ?? "",
    carModelNames: normalizeCarModelNames(input),
    requiredTokens: normalizeRequiredTokens(input.requiredTokens),
    fitmentYear: input.fitmentYear ?? null,
    categoryNames: normalizeStringArray(input.categoryNames),
    brandIds: normalizeStringArray(input.brandIds),
    carBrandNames: normalizeStringArray(input.carBrandNames),
    yearMin: normalizeYearBound(input.yearMin),
    yearMax: normalizeYearBound(input.yearMax),
    priceMin: normalizePriceBound(input.priceMin),
    priceMax: normalizePriceBound(input.priceMax),
    stockStatus: input.stockStatus ?? null,
    inventoryTracking: input.inventoryTracking ?? null,
    skip: input.skip ?? 0,
    take: input.take ?? 30,
    order: input.order ?? "createdAtDesc",
    cacheProfile,
    // Keep bot (lexical-only) and human (hybrid) results in separate cache entries.
    disableSemantic: input.disableSemantic ?? false,
    disableBroadFallback: input.disableBroadFallback ?? false,
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
