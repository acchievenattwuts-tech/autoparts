import { buildAdminProductFitmentSummary } from "@/lib/admin-product-fitment";
import { db, withDbRetry } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma";
import { formatShelfLocationCode } from "@/lib/shelf-location-rules";
import { loadProductShelfLocationViews } from "@/lib/shelf-map";
import { parseShelfMapFilters, type ShelfMapFilters, type ShelfSearchParams } from "@/lib/shelf-map-filters";
import { formatDateThai, parseDateOnlyToEndOfDay, parseDateOnlyToStartOfDay } from "@/lib/th-date";

/**
 * Put-away queue (ตั้งที่เก็บสินค้า), phase 1b of the shelf map. No receipt is referenced:
 * the queue is derived from product state only (owner, 2026-10-20).
 *
 * - "unlocated" (ยังไม่มีที่เก็บ): active, tracked, stock > 0, no location at all.
 * - "received" (รับเข้าใหม่ — ยืนยันที่เก็บ): active, tracked, stock > 0, has a location, and its
 *   last receipt date (Product.purchaseLastDate, a Thailand date) is a later DAY than the latest
 *   verifiedAt of its locations. Same-day receipts after a confirmation are not asked (accepted).
 *
 * Both tabs list the most recently received first.
 */

export const PUT_AWAY_PAGE_SIZE = 30;
export const PUT_AWAY_FITMENT_LINES = 3;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type PutAwayTab = "unlocated" | "received";

export type PutAwayFilters = Pick<ShelfMapFilters, "q" | "categoryIds" | "brandId" | "carBrandId"> & {
  tab: PutAwayTab;
  /** Received-date range (YYYY-MM-DD, Thailand dates); empty = no bound. */
  receivedFrom: string;
  receivedTo: string;
  page: number;
};

const firstValue = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? (value[0] ?? "") : (value ?? "")).trim();

const dateKeyOrEmpty = (value: string): string => (DATE_KEY_PATTERN.test(value) ? value : "");

export const parsePutAwayFilters = (params: ShelfSearchParams): PutAwayFilters => {
  const shelf = parseShelfMapFilters(params);
  const page = Number.parseInt(firstValue(params.page), 10);
  return {
    q: shelf.q,
    categoryIds: shelf.categoryIds,
    brandId: shelf.brandId,
    carBrandId: shelf.carBrandId,
    tab: firstValue(params.tab) === "received" ? "received" : "unlocated",
    receivedFrom: dateKeyOrEmpty(firstValue(params.from)),
    receivedTo: dateKeyOrEmpty(firstValue(params.to)),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
};

/** Query string for tab, pagination and "วันนี้" links; page 1 and the default tab are left out. */
export const buildPutAwayQuery = (filters: PutAwayFilters, overrides: Partial<PutAwayFilters> = {}): string => {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (merged.tab !== "unlocated") params.set("tab", merged.tab);
  if (merged.q) params.set("q", merged.q);
  for (const id of merged.categoryIds) params.append("categoryId", id);
  if (merged.brandId) params.set("brandId", merged.brandId);
  if (merged.carBrandId) params.set("carBrandId", merged.carBrandId);
  if (merged.receivedFrom) params.set("from", merged.receivedFrom);
  if (merged.receivedTo) params.set("to", merged.receivedTo);
  if (merged.page > 1) params.set("page", String(merged.page));
  return params.toString();
};

export const hasPutAwayProductFilters = (filters: PutAwayFilters): boolean =>
  Boolean(filters.q || filters.categoryIds.length > 0 || filters.brandId || filters.carBrandId);

// ─── SQL (exported for the PGlite tests) ────────────────────────────────────

export type PutAwayQueueInput = {
  /** Product ids from the search/category/brand filters, or null for no product filter. */
  productIds: readonly string[] | null;
  receivedFrom: string;
  receivedTo: string;
};

const HAS_LOCATION = Prisma.sql`EXISTS (SELECT 1 FROM "ProductShelfLocation" l WHERE l."productId" = p.id)`;

/** Thailand day of the last receipt is after the Thailand day of the last confirmation. */
const RECEIVED_AFTER_CONFIRMATION = Prisma.sql`(
  p."purchaseLastDate" IS NOT NULL
  AND ${HAS_LOCATION}
  AND (p."purchaseLastDate" AT TIME ZONE 'Asia/Bangkok')::date > COALESCE(
    (SELECT (max(l."verifiedAt") AT TIME ZONE 'Asia/Bangkok')::date FROM "ProductShelfLocation" l WHERE l."productId" = p.id),
    DATE '-infinity'
  )
)`;

export const PUT_AWAY_TAB_CONDITIONS: Record<PutAwayTab, Prisma.Sql> = {
  unlocated: Prisma.sql`NOT ${HAS_LOCATION}`,
  received: RECEIVED_AFTER_CONFIRMATION,
};

const buildBaseConditions = (input: PutAwayQueueInput): Prisma.Sql => {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`p."isActive" = true`,
    Prisma.sql`p."inventoryTracking" = 'TRACKED'`,
    Prisma.sql`p.stock > 0`,
  ];
  if (input.productIds) conditions.push(Prisma.sql`p.id = ANY(${[...input.productIds]}::text[])`);
  if (input.receivedFrom) {
    conditions.push(Prisma.sql`p."purchaseLastDate" >= ${parseDateOnlyToStartOfDay(input.receivedFrom)}`);
  }
  if (input.receivedTo) {
    conditions.push(Prisma.sql`p."purchaseLastDate" <= ${parseDateOnlyToEndOfDay(input.receivedTo)}`);
  }
  return Prisma.join(conditions, " AND ");
};

export const buildPutAwayCountSql = (input: PutAwayQueueInput): Prisma.Sql => Prisma.sql`
  SELECT
    count(*) FILTER (WHERE ${PUT_AWAY_TAB_CONDITIONS.unlocated})::int AS unlocated,
    count(*) FILTER (WHERE ${PUT_AWAY_TAB_CONDITIONS.received})::int AS received
  FROM "Product" p
  WHERE ${buildBaseConditions(input)}
`;

export const buildPutAwayListSql = (
  input: PutAwayQueueInput & { tab: PutAwayTab; take: number; skip: number },
): Prisma.Sql => Prisma.sql`
  SELECT p.id
  FROM "Product" p
  WHERE ${buildBaseConditions(input)} AND ${PUT_AWAY_TAB_CONDITIONS[input.tab]}
  ORDER BY p."purchaseLastDate" DESC NULLS LAST, p.code ASC
  LIMIT ${input.take}::int OFFSET ${input.skip}::int
`;

// ─── Suggested location ─────────────────────────────────────────────────────

/** Home locations of other products, grouped by category (and car brand when byCarBrand). */
export type PutAwaySuggestionRow = {
  categoryId: string;
  carBrandId: string | null;
  byCarBrand: boolean;
  rackId: string;
  rackCode: string;
  level: number;
  products: number;
};

export type PutAwaySuggestion = {
  rackId: string;
  level: number;
  code: string;
  /** "คอยล์เย็น · Toyota 12 รายการ" or "คอยล์เย็น 8 รายการ". */
  reason: string;
};

const bestRow = (rows: readonly PutAwaySuggestionRow[]): PutAwaySuggestionRow | null =>
  rows.reduce<PutAwaySuggestionRow | null>((best, row) => {
    if (!best) return row;
    if (row.products !== best.products) return row.products > best.products ? row : best;
    const byCode = row.rackCode.localeCompare(best.rackCode);
    if (byCode !== 0) return byCode < 0 ? row : best;
    return row.level < best.level ? row : best;
  }, null);

/**
 * Where products like this one are usually kept: the most common home location among products
 * of the same category and one of its car brands, else of the same category. Null when none.
 */
export const pickPutAwaySuggestion = (
  product: { categoryId: string; categoryName: string; carBrandIds: readonly string[] },
  rows: readonly PutAwaySuggestionRow[],
  carBrandNames: ReadonlyMap<string, string>,
): PutAwaySuggestion | null => {
  const sameCategory = rows.filter((row) => row.categoryId === product.categoryId);
  const byBrand = bestRow(
    sameCategory.filter((row) => row.byCarBrand && row.carBrandId !== null && product.carBrandIds.includes(row.carBrandId)),
  );
  const chosen = byBrand ?? bestRow(sameCategory.filter((row) => !row.byCarBrand));
  if (!chosen) return null;
  const brandName = byBrand && chosen.carBrandId ? carBrandNames.get(chosen.carBrandId) : undefined;
  const label = brandName ? `${product.categoryName} · ${brandName}` : product.categoryName;
  return {
    rackId: chosen.rackId,
    level: chosen.level,
    code: formatShelfLocationCode(chosen.rackCode, chosen.level),
    reason: `${label} ${chosen.products.toLocaleString("th-TH")} รายการ`,
  };
};

/** One grouped query over home locations on active racks, limited to the given categories. */
export const buildPutAwaySuggestionSql = (categoryIds: readonly string[]): Prisma.Sql => Prisma.sql`
  SELECT
    p."categoryId" AS "categoryId",
    cm."carBrandId" AS "carBrandId",
    (GROUPING(cm."carBrandId") = 0) AS "byCarBrand",
    l."rackId" AS "rackId",
    r.code AS "rackCode",
    l.level AS level,
    count(DISTINCT p.id)::int AS products
  FROM "ProductShelfLocation" l
  JOIN "ShelfRack" r ON r.id = l."rackId" AND r."isActive" = true AND l.level <= r.levels
  JOIN "Product" p ON p.id = l."productId" AND p."isActive" = true
  LEFT JOIN "ProductFitment" f ON f."productId" = p.id AND f."fitmentType" = 'DIRECT'
  LEFT JOIN "CarModel" cm ON cm.id = f."carModelId"
  WHERE l."isPrimary" = true AND p."categoryId" = ANY(${[...categoryIds]}::text[])
  GROUP BY GROUPING SETS ((p."categoryId", cm."carBrandId", l."rackId", r.code, l.level), (p."categoryId", l."rackId", r.code, l.level))
`;

// ─── Loaders ────────────────────────────────────────────────────────────────

export type PutAwayCounts = Record<PutAwayTab, number>;

export type PutAwayLocation = { id: string; code: string; isPrimary: boolean; note: string | null };

export type PutAwayItem = {
  id: string;
  code: string;
  name: string;
  stock: number;
  unitName: string;
  categoryName: string;
  brandName: string | null;
  /** Thai Gregorian date of the last receipt, or null when never received. */
  receivedOn: string | null;
  fitmentLines: string[];
  fitmentHidden: number;
  locations: PutAwayLocation[];
  suggestion: PutAwaySuggestion | null;
};

export const loadPutAwayCounts = async (input: PutAwayQueueInput): Promise<PutAwayCounts> => {
  if (input.productIds && input.productIds.length === 0) return { unlocated: 0, received: 0 };
  const rows = await withDbRetry(() => db.$queryRaw<PutAwayCounts[]>(buildPutAwayCountSql(input)));
  return rows[0] ?? { unlocated: 0, received: 0 };
};

const loadSuggestionRows = async (categoryIds: readonly string[]): Promise<PutAwaySuggestionRow[]> =>
  categoryIds.length === 0
    ? []
    : withDbRetry(() => db.$queryRaw<PutAwaySuggestionRow[]>(buildPutAwaySuggestionSql(categoryIds)));

/** One page of a tab, with each product's locations, fitment summary and suggested location. */
export const loadPutAwayPage = async (
  input: PutAwayQueueInput & { tab: PutAwayTab; page: number; carBrandNames: ReadonlyMap<string, string> },
): Promise<PutAwayItem[]> => {
  if (input.productIds && input.productIds.length === 0) return [];
  const idRows = await withDbRetry(() =>
    db.$queryRaw<{ id: string }[]>(
      buildPutAwayListSql({ ...input, take: PUT_AWAY_PAGE_SIZE, skip: (input.page - 1) * PUT_AWAY_PAGE_SIZE }),
    ),
  );
  const ids = idRows.map((row) => row.id);
  if (ids.length === 0) return [];

  const [products, locationsByProduct] = await Promise.all([
    withDbRetry(() =>
      db.product.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          code: true,
          name: true,
          stock: true,
          reportUnitName: true,
          purchaseLastDate: true,
          categoryId: true,
          category: { select: { name: true } },
          brand: { select: { name: true } },
          carModels: {
            where: { fitmentType: "DIRECT" },
            select: {
              yearStart: true,
              yearEnd: true,
              carModel: { select: { name: true, carBrandId: true, carBrand: { select: { name: true } } } },
            },
            orderBy: [{ carModelId: "asc" }, { yearStart: "asc" }, { yearEnd: "asc" }],
          },
        },
      }),
    ),
    withDbRetry(() => loadProductShelfLocationViews(db, ids)),
  ]);
  const suggestionRows = await loadSuggestionRows([...new Set(products.map((product) => product.categoryId))]);

  const byId = new Map(products.map((product) => [product.id, product]));
  return ids.flatMap((id): PutAwayItem[] => {
    const product = byId.get(id);
    if (!product) return [];
    const fitment = buildAdminProductFitmentSummary(product.carModels);
    const carBrandIds = [...new Set(product.carModels.map((item) => item.carModel.carBrandId))];
    return [
      {
        id: product.id,
        code: product.code,
        name: product.name,
        stock: product.stock,
        unitName: product.reportUnitName,
        categoryName: product.category.name,
        brandName: product.brand?.name ?? null,
        receivedOn: product.purchaseLastDate ? formatDateThai(product.purchaseLastDate) : null,
        fitmentLines: fitment.lines.slice(0, PUT_AWAY_FITMENT_LINES),
        fitmentHidden: Math.max(0, fitment.lines.length - PUT_AWAY_FITMENT_LINES),
        locations: (locationsByProduct.get(id) ?? []).map(({ id: locationId, code, isPrimary, note }) => ({
          id: locationId,
          code,
          isPrimary,
          note,
        })),
        suggestion: pickPutAwaySuggestion(
          { categoryId: product.categoryId, categoryName: product.category.name, carBrandIds },
          suggestionRows,
          input.carBrandNames,
        ),
      },
    ];
  });
};
