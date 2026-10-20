import { db, withDbRetry } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma";
import { formatShelfLocationCode } from "@/lib/shelf-location-rules";
import { loadProductShelfLocationViews } from "@/lib/shelf-map";
import type { ShelfLocationStatusFilter } from "@/lib/shelf-map-filters";

/**
 * Read side of the shelf map page (ผังชั้นวาง) and its rack setup page.
 *
 * Egress rules: the grid is built from one grouped query (counts per cell and category,
 * trimmed to the top categories in SQL), the stat row is one single-row query, and the
 * product lists load only the rows they render. Pure helpers that shape those results
 * are exported for unit tests.
 */

/** Categories named inside a grid cell ("คอยล์เย็น 12 · วาล์วแอร์ 5"). */
export const SHELF_CELL_TOP_CATEGORIES = 2;
/** Products listed under a selected cell. */
export const SHELF_CELL_LIST_LIMIT = 200;
/** Products listed in the "where is it?" result list. */
export const SHELF_RESULT_LIST_LIMIT = 100;
/** Product codes named when a rack change is blocked by existing locations. */
export const SHELF_GUARD_LIST_LIMIT = 10;

const UNKNOWN_CATEGORY_NAME = "ไม่ระบุหมวด";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ShelfMapRack = {
  id: string;
  code: string;
  name: string | null;
  levels: number;
};

/** One (cell, category) row of the grid aggregate, limited to each cell's top categories. */
export type ShelfCellAggregateRow = {
  rackId: string;
  level: number;
  categoryId: string;
  categoryTotal: number;
  cellTotal: number;
  cellInStock: number;
  categoryGroups: number;
};

export type ShelfCellCategory = { name: string; count: number };

export type ShelfGridCell = {
  rackId: string;
  rackCode: string;
  level: number;
  code: string;
  /** Matching products located here. */
  total: number;
  /** Matching products located here with stock > 0 ("มีของ" when above zero). */
  inStock: number;
  topCategories: ShelfCellCategory[];
  moreCategoryCount: number;
};

export type ShelfGridRow = {
  level: number;
  /** One entry per rack, in rack order; null where the rack has no such level. */
  cells: (ShelfGridCell | null)[];
};

export type ShelfGridModel = {
  racks: ShelfMapRack[];
  /** Top level first, level 1 (the bottom shelf) last. */
  rows: ShelfGridRow[];
  cellCount: number;
  matchedCellCount: number;
  stockedCellCount: number;
};

export type ShelfMapStats = {
  locatedProducts: number;
  unlocatedInStock: number;
  secondaryLocations: number;
};

export type ShelfBadgeLocation = {
  id: string;
  code: string;
  isPrimary: boolean;
  note: string | null;
};

export type ShelfProductListItem = {
  id: string;
  code: string;
  name: string;
  stock: number;
  unitName: string;
  categoryName: string;
  brandName: string | null;
  locations: ShelfBadgeLocation[];
  /** verifiedAt of the selected cell's location (cell detail only). */
  verifiedAt: Date | null;
};

export type ShelfProductGroup = { categoryName: string; items: ShelfProductListItem[] };

export type ShelfRackAdminRow = {
  id: string;
  code: string;
  name: string | null;
  levels: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  productCount: number;
  maxUsedLevel: number;
};

export type ShelfBlockingLocations = {
  items: { productCode: string; locationCode: string }[];
  total: number;
};

// ─── Pure helpers ───────────────────────────────────────────────────────────

const cellKey = (rackId: string, level: number): string => `${rackId}:${level}`;

type CellSummary = Pick<ShelfGridCell, "total" | "inStock" | "topCategories" | "moreCategoryCount">;

const summarizeCells = (
  aggregates: readonly ShelfCellAggregateRow[],
  categoryNames: ReadonlyMap<string, string>,
  topLimit: number,
): Map<string, CellSummary> => {
  const byCell = new Map<string, { row: ShelfCellAggregateRow; categories: ShelfCellCategory[] }>();
  for (const row of aggregates) {
    const key = cellKey(row.rackId, row.level);
    const entry = byCell.get(key) ?? { row, categories: [] };
    entry.categories.push({ name: categoryNames.get(row.categoryId) ?? UNKNOWN_CATEGORY_NAME, count: row.categoryTotal });
    byCell.set(key, entry);
  }
  const result = new Map<string, CellSummary>();
  for (const [key, { row, categories }] of byCell) {
    const sorted = [...categories].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "th"));
    const topCategories = sorted.slice(0, topLimit);
    result.set(key, {
      total: row.cellTotal,
      inStock: row.cellInStock,
      topCategories,
      moreCategoryCount: Math.max(0, row.categoryGroups - topCategories.length),
    });
  }
  return result;
};

/**
 * Lays racks out as columns and levels as rows, tallest rack's top level first, so the
 * screen reads like the shelves in front of you (level 1 at the bottom). A rack with
 * fewer levels gets a null placeholder above its top level.
 */
export const buildShelfGridModel = (
  racks: readonly ShelfMapRack[],
  aggregates: readonly ShelfCellAggregateRow[],
  categoryNames: ReadonlyMap<string, string>,
  topLimit: number = SHELF_CELL_TOP_CATEGORIES,
): ShelfGridModel => {
  const summaries = summarizeCells(aggregates, categoryNames, topLimit);
  const maxLevel = racks.reduce((max, rack) => Math.max(max, rack.levels), 0);
  const rows: ShelfGridRow[] = [];
  let cellCount = 0;
  let matchedCellCount = 0;
  let stockedCellCount = 0;

  for (let level = maxLevel; level >= 1; level -= 1) {
    const cells = racks.map((rack): ShelfGridCell | null => {
      if (level > rack.levels) return null;
      const summary = summaries.get(cellKey(rack.id, level));
      const cell: ShelfGridCell = {
        rackId: rack.id,
        rackCode: rack.code,
        level,
        code: formatShelfLocationCode(rack.code, level),
        total: summary?.total ?? 0,
        inStock: summary?.inStock ?? 0,
        topCategories: summary?.topCategories ?? [],
        moreCategoryCount: summary?.moreCategoryCount ?? 0,
      };
      cellCount += 1;
      if (cell.total > 0) matchedCellCount += 1;
      if (cell.inStock > 0) stockedCellCount += 1;
      return cell;
    });
    rows.push({ level, cells });
  }

  return { racks: [...racks], rows, cellCount, matchedCellCount, stockedCellCount };
};

/** The grid cell for "A" + 2, or null when the rack or level is not on the map. */
export const findShelfGridCell = (model: ShelfGridModel, rackCode: string, level: number | null): ShelfGridCell | null => {
  if (!rackCode || level === null) return null;
  for (const row of model.rows) {
    if (row.level !== level) continue;
    return row.cells.find((cell) => cell?.rackCode === rackCode) ?? null;
  }
  return null;
};

/** "คอยล์เย็น 12 · วาล์วแอร์ 5 · +2 หมวด" */
export const formatShelfCellCategories = (cell: Pick<ShelfGridCell, "topCategories" | "moreCategoryCount">): string => {
  const parts = cell.topCategories.map((category) => `${category.name} ${category.count.toLocaleString("th-TH")}`);
  if (cell.moreCategoryCount > 0) parts.push(`+${cell.moreCategoryCount} หมวด`);
  return parts.join(" · ");
};

/** Category groups, biggest first, then by Thai name; items keep their incoming order. */
export const groupShelfProductsByCategory = (items: readonly ShelfProductListItem[]): ShelfProductGroup[] => {
  const groups = new Map<string, ShelfProductListItem[]>();
  for (const item of items) {
    const group = groups.get(item.categoryName) ?? [];
    group.push(item);
    groups.set(item.categoryName, group);
  }
  return [...groups.entries()]
    .map(([categoryName, groupItems]) => ({ categoryName, items: groupItems }))
    .sort((a, b) => b.items.length - a.items.length || a.categoryName.localeCompare(b.categoryName, "th"));
};

/** "P001 (A-5), P002 (A-4) และอีก 3 รายการ" */
export const formatShelfBlockingList = (blocking: ShelfBlockingLocations): string => {
  const shown = blocking.items.map((item) => `${item.productCode} (${item.locationCode})`).join(", ");
  const rest = blocking.total - blocking.items.length;
  return rest > 0 ? `${shown} และอีก ${rest.toLocaleString("th-TH")} รายการ` : shown;
};

type ShelfProductFilterInput = {
  productIds: readonly string[] | null;
  inStockOnly: boolean;
};

/** Active products, optionally limited to the filter's product ids and to stock > 0. */
export const buildShelfProductWhere = (input: ShelfProductFilterInput): Prisma.ProductWhereInput => ({
  isActive: true,
  ...(input.productIds ? { id: { in: [...input.productIds] } } : {}),
  ...(input.inStockOnly ? { stock: { gt: 0 } } : {}),
});

export type ShelfResultListInput = ShelfProductFilterInput & {
  location: ShelfLocationStatusFilter;
  primaryOnly: boolean;
  /** Limit to products located in this rack (any level), from a rack header link. */
  rackId: string | null;
};

/**
 * Product filter for the "where is it?" list. "unlocated" wins over a rack; primaryOnly
 * only narrows location conditions (it never turns "all" into "located").
 */
export const buildShelfResultProductWhere = (input: ShelfResultListInput): Prisma.ProductWhereInput => {
  const where = buildShelfProductWhere(input);
  if (input.location === "unlocated") return { ...where, shelfLocations: { none: {} } };
  if (input.location === "located" || input.rackId) {
    return {
      ...where,
      shelfLocations: {
        some: {
          ...(input.primaryOnly ? { isPrimary: true } : {}),
          ...(input.rackId ? { rackId: input.rackId } : {}),
        },
      },
    };
  }
  return where;
};

// ─── Queries: shelf map page ────────────────────────────────────────────────

/** Active racks in display order (sortOrder, then code). */
export const loadShelfMapRacks = async (): Promise<ShelfMapRack[]> =>
  withDbRetry(() =>
    db.shelfRack.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true, levels: true },
    }),
  );

/** Whole-shop progress figures for the stat row, in one single-row query. */
export const loadShelfMapStats = async (): Promise<ShelfMapStats> => {
  const rows = await withDbRetry(() =>
    db.$queryRaw<ShelfMapStats[]>(Prisma.sql`
      SELECT
        count(*) FILTER (
          WHERE EXISTS (SELECT 1 FROM "ProductShelfLocation" l WHERE l."productId" = p.id)
        )::int AS "locatedProducts",
        count(*) FILTER (
          WHERE p.stock > 0
            AND NOT EXISTS (SELECT 1 FROM "ProductShelfLocation" l WHERE l."productId" = p.id)
        )::int AS "unlocatedInStock",
        (
          SELECT count(*)
          FROM "ProductShelfLocation" s
          JOIN "Product" sp ON sp.id = s."productId"
          WHERE s."isPrimary" = false AND sp."isActive" = true
        )::int AS "secondaryLocations"
      FROM "Product" p
      WHERE p."isActive" = true
    `),
  );
  return rows[0] ?? { locatedProducts: 0, unlocatedInStock: 0, secondaryLocations: 0 };
};

export type ShelfCellAggregateInput = ShelfProductFilterInput & { primaryOnly: boolean };

/**
 * Matching products per (rack, level), with the top categories of each cell. Grouped and
 * trimmed in SQL, so the result is a few rows per cell however many products there are.
 */
export const loadShelfCellAggregates = async (input: ShelfCellAggregateInput): Promise<ShelfCellAggregateRow[]> => {
  if (input.productIds && input.productIds.length === 0) return [];
  const conditions: Prisma.Sql[] = [Prisma.sql`p."isActive" = true`];
  if (input.primaryOnly) conditions.push(Prisma.sql`l."isPrimary" = true`);
  if (input.inStockOnly) conditions.push(Prisma.sql`p.stock > 0`);
  if (input.productIds) conditions.push(Prisma.sql`p.id = ANY(${[...input.productIds]}::text[])`);

  return withDbRetry(() =>
    db.$queryRaw<ShelfCellAggregateRow[]>(Prisma.sql`
      WITH grouped AS (
        SELECT
          l."rackId" AS "rackId",
          l.level AS level,
          p."categoryId" AS "categoryId",
          count(*)::int AS total,
          count(*) FILTER (WHERE p.stock > 0)::int AS "inStock"
        FROM "ProductShelfLocation" l
        JOIN "Product" p ON p.id = l."productId"
        WHERE ${Prisma.join(conditions, " AND ")}
        GROUP BY l."rackId", l.level, p."categoryId"
      ),
      ranked AS (
        SELECT
          g.*,
          row_number() OVER (PARTITION BY g."rackId", g.level ORDER BY g.total DESC, g."categoryId") AS rank,
          sum(g.total) OVER (PARTITION BY g."rackId", g.level)::int AS "cellTotal",
          sum(g."inStock") OVER (PARTITION BY g."rackId", g.level)::int AS "cellInStock",
          count(*) OVER (PARTITION BY g."rackId", g.level)::int AS "categoryGroups"
        FROM grouped g
      )
      SELECT "rackId", level, "categoryId", total AS "categoryTotal", "cellTotal", "cellInStock", "categoryGroups"
      FROM ranked
      WHERE rank <= ${SHELF_CELL_TOP_CATEGORIES}::int
      ORDER BY "rackId", level, rank
    `),
  );
};

/** Display rows for the given products, in the given order, with all their locations. */
const loadShelfProductItems = async (
  productIds: readonly string[],
  verifiedAtByProduct: ReadonlyMap<string, Date | null> = new Map(),
): Promise<ShelfProductListItem[]> => {
  if (productIds.length === 0) return [];
  const [products, locationsByProduct] = await Promise.all([
    withDbRetry(() =>
      db.product.findMany({
        where: { id: { in: [...productIds] } },
        select: {
          id: true,
          code: true,
          name: true,
          stock: true,
          reportUnitName: true,
          category: { select: { name: true } },
          brand: { select: { name: true } },
        },
      }),
    ),
    withDbRetry(() => loadProductShelfLocationViews(db, productIds)),
  ]);
  const byId = new Map(products.map((product) => [product.id, product]));
  return productIds.flatMap((id): ShelfProductListItem[] => {
    const product = byId.get(id);
    if (!product) return [];
    return [
      {
        id: product.id,
        code: product.code,
        name: product.name,
        stock: product.stock,
        unitName: product.reportUnitName,
        categoryName: product.category.name,
        brandName: product.brand?.name ?? null,
        locations: (locationsByProduct.get(id) ?? []).map(({ id: locationId, code, isPrimary, note }) => ({
          id: locationId,
          code,
          isPrimary,
          note,
        })),
        verifiedAt: verifiedAtByProduct.get(id) ?? null,
      },
    ];
  });
};

export type ShelfCellProductsInput = ShelfCellAggregateInput & { rackId: string; level: number };

/** Products located in one cell (respecting the filters), by product code, capped. */
export const loadShelfCellProducts = async (
  input: ShelfCellProductsInput,
): Promise<{ items: ShelfProductListItem[]; capped: boolean }> => {
  if (input.productIds && input.productIds.length === 0) return { items: [], capped: false };
  const rows = await withDbRetry(() =>
    db.productShelfLocation.findMany({
      where: {
        rackId: input.rackId,
        level: input.level,
        ...(input.primaryOnly ? { isPrimary: true } : {}),
        product: buildShelfProductWhere(input),
      },
      select: { productId: true, verifiedAt: true },
      orderBy: { product: { code: "asc" } },
      take: SHELF_CELL_LIST_LIMIT + 1,
    }),
  );
  const kept = rows.slice(0, SHELF_CELL_LIST_LIMIT);
  const items = await loadShelfProductItems(
    kept.map((row) => row.productId),
    new Map(kept.map((row) => [row.productId, row.verifiedAt])),
  );
  return { items, capped: rows.length > SHELF_CELL_LIST_LIMIT };
};

/**
 * The "where is it?" list. With a product search the search engine's ranking is kept
 * (ids only are read to apply the location/stock conditions); without one, by code.
 */
export const loadShelfResultList = async (
  input: ShelfResultListInput,
): Promise<{ items: ShelfProductListItem[]; total: number }> => {
  if (input.productIds && input.productIds.length === 0) return { items: [], total: 0 };
  const where = buildShelfResultProductWhere(input);

  if (input.productIds) {
    const matched = await withDbRetry(() => db.product.findMany({ where, select: { id: true } }));
    const matchedIds = new Set(matched.map((row) => row.id));
    const ordered = input.productIds.filter((id) => matchedIds.has(id));
    const items = await loadShelfProductItems(ordered.slice(0, SHELF_RESULT_LIST_LIMIT));
    return { items, total: ordered.length };
  }

  const [rows, total] = await Promise.all([
    withDbRetry(() =>
      db.product.findMany({ where, select: { id: true }, orderBy: { code: "asc" }, take: SHELF_RESULT_LIST_LIMIT }),
    ),
    withDbRetry(() => db.product.count({ where })),
  ]);
  const items = await loadShelfProductItems(rows.map((row) => row.id));
  return { items, total };
};

// ─── Queries: rack setup page and its guards ────────────────────────────────

/** Every rack with how many products it holds and its highest used level. */
export const loadShelfRackAdminRows = async (): Promise<ShelfRackAdminRow[]> => {
  const [racks, usage] = await Promise.all([
    withDbRetry(() =>
      db.shelfRack.findMany({
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        select: { id: true, code: true, name: true, levels: true, sortOrder: true, isActive: true, createdAt: true },
      }),
    ),
    withDbRetry(() =>
      db.$queryRaw<{ rackId: string; productCount: number; maxUsedLevel: number }[]>(Prisma.sql`
        SELECT "rackId", count(DISTINCT "productId")::int AS "productCount", max(level)::int AS "maxUsedLevel"
        FROM "ProductShelfLocation"
        GROUP BY "rackId"
      `),
    ),
  ]);
  const usageByRack = new Map(usage.map((row) => [row.rackId, row]));
  return racks.map((rack) => ({
    ...rack,
    productCount: usageByRack.get(rack.id)?.productCount ?? 0,
    maxUsedLevel: usageByRack.get(rack.id)?.maxUsedLevel ?? 0,
  }));
};

/**
 * Locations that stop a rack change: every location in the rack (deactivation) or those
 * above `aboveLevel` (reducing levels). Runs inside the caller's transaction.
 */
export const loadShelfRackBlockingLocations = async (
  client: Prisma.TransactionClient,
  input: { rackId: string; rackCode: string; aboveLevel?: number },
): Promise<ShelfBlockingLocations> => {
  const where: Prisma.ProductShelfLocationWhereInput = {
    rackId: input.rackId,
    ...(input.aboveLevel !== undefined ? { level: { gt: input.aboveLevel } } : {}),
  };
  const total = await client.productShelfLocation.count({ where });
  if (total === 0) return { items: [], total: 0 };
  const rows = await client.productShelfLocation.findMany({
    where,
    select: { level: true, product: { select: { code: true } } },
    orderBy: [{ level: "desc" }, { product: { code: "asc" } }],
    take: SHELF_GUARD_LIST_LIMIT,
  });
  return {
    items: rows.map((row) => ({
      productCode: row.product.code,
      locationCode: formatShelfLocationCode(input.rackCode, row.level),
    })),
    total,
  };
};
