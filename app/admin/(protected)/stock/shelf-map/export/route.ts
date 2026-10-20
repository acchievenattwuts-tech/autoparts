export const dynamic = "force-dynamic";

import { z } from "zod";

import { getAllCategoryFilterOptions, getAdminProductFilterOptions } from "@/lib/admin-master-options";
import { getAuditActorFromSession, getRequestContextFromHeaders, safeWriteAuditLog } from "@/lib/audit-log";
import { db } from "@/lib/db";
import { AuditAction, type Prisma } from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";
import {
  buildShelfLocationWorkbook,
  countShelfExportRows,
  formatShelfFitmentText,
  SHELF_EXPORT_EXTRA_ROWS,
  SHELF_EXPORT_MODES,
  SHELF_IMPORT_MAX_ROWS,
  type ShelfExportMode,
  type ShelfExportProduct,
  type ShelfExportRack,
  type ShelfFitmentName,
} from "@/lib/shelf-location-excel";
import {
  buildShelfMapFilterQuery,
  describeShelfMapFilters,
  parseShelfMapFilters,
  resolveShelfFilterProductIds,
  SHELF_FILTER_MAX_PRODUCTS,
  type ShelfMapFilters,
  type ShelfSearchParams,
} from "@/lib/shelf-map-filters";
import { getThailandDateKey } from "@/lib/th-date";

/** Fitment rows read per product for the short รุ่นรถ column; names come from the cached master list. */
const FITMENT_MODELS_PER_PRODUCT = 6;
const MAX_EXPORT_ITEM_ROWS = SHELF_IMPORT_MAX_ROWS - SHELF_EXPORT_EXTRA_ROWS;
const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const modeSchema = z.enum(SHELF_EXPORT_MODES).catch("survey");

const textResponse = (message: string, status: number): Response =>
  new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

const toSearchParamRecord = (params: URLSearchParams): ShelfSearchParams => {
  const record: ShelfSearchParams = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    record[key] = values.length > 1 ? values : values[0];
  }
  return record;
};

/** Location filters: rack (with its level) and primary-only narrow which location rows are listed. */
const buildLocationWhere = (
  filters: ShelfMapFilters,
  racks: readonly ShelfExportRack[],
): Prisma.ProductShelfLocationWhereInput => {
  const where: Prisma.ProductShelfLocationWhereInput = {};
  if (filters.rackCode) {
    const rack = racks.find((item) => item.code === filters.rackCode);
    where.rackId = { in: rack ? [rack.id] : [] };
    if (filters.level !== null) where.level = filters.level;
  }
  if (filters.primaryOnly) where.isPrimary = true;
  return where;
};

const buildProductWhere = (
  filters: ShelfMapFilters,
  productIds: string[] | null,
  locationWhere: Prisma.ProductShelfLocationWhereInput,
): Prisma.ProductWhereInput => {
  const where: Prisma.ProductWhereInput = { isActive: true };
  if (filters.inStockOnly) where.stock = { gt: 0 };
  if (productIds) where.id = { in: productIds };
  if (filters.location === "unlocated") where.shelfLocations = { none: {} };
  else if (filters.location === "located" || filters.rackCode) where.shelfLocations = { some: locationWhere };
  return where;
};

type NameMaps = {
  categories: Map<string, string>;
  partsBrands: Map<string, string>;
  carBrands: Map<string, string>;
  carModels: Map<string, ShelfFitmentName>;
};

const loadNameMaps = async (): Promise<NameMaps> => {
  const [options, categories] = await Promise.all([getAdminProductFilterOptions(), getAllCategoryFilterOptions()]);
  return {
    categories: new Map(categories.map((category) => [category.id, category.name])),
    partsBrands: new Map(options.partsBrands.map((brand) => [brand.id, brand.name])),
    carBrands: new Map(options.carBrands.map((brand) => [brand.id, brand.name])),
    carModels: new Map(
      options.carBrands.flatMap((brand) =>
        brand.carModels.map((model): [string, ShelfFitmentName] => [model.id, { brand: brand.name, model: model.name }]),
      ),
    ),
  };
};

/** Inactive parts brands are not in the cached list; fetch just those names. */
const addMissingBrandNames = async (brandIds: readonly (string | null)[], partsBrands: Map<string, string>): Promise<void> => {
  const missing = [...new Set(brandIds.flatMap((id) => (id && !partsBrands.has(id) ? [id] : [])))];
  if (missing.length === 0) return;
  const rows = await db.partsBrand.findMany({ where: { id: { in: missing } }, select: { id: true, name: true } });
  for (const row of rows) partsBrands.set(row.id, row.name);
};

const loadExportProducts = async (
  filters: ShelfMapFilters,
  productIds: string[] | null,
  racks: readonly ShelfExportRack[],
  names: NameMaps,
): Promise<ShelfExportProduct[]> => {
  const locationWhere = buildLocationWhere(filters, racks);
  const rows = await db.product.findMany({
    where: buildProductWhere(filters, productIds, locationWhere),
    orderBy: { code: "asc" },
    take: SHELF_FILTER_MAX_PRODUCTS,
    select: {
      id: true,
      code: true,
      name: true,
      stock: true,
      categoryId: true,
      brandId: true,
      carModels: { select: { carModelId: true }, orderBy: { carModelId: "asc" }, take: FITMENT_MODELS_PER_PRODUCT },
      shelfLocations: {
        where: locationWhere,
        select: { id: true, rackId: true, level: true, isPrimary: true, createdAt: true },
      },
    },
  });
  await addMissingBrandNames(rows.map((row) => row.brandId), names.partsBrands);
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    categoryName: names.categories.get(row.categoryId) ?? "",
    brandName: row.brandId ? (names.partsBrands.get(row.brandId) ?? "") : "",
    fitmentText: formatShelfFitmentText(
      row.carModels.flatMap((fitment) => {
        const name = names.carModels.get(fitment.carModelId);
        return name ? [name] : [];
      }),
    ),
    stock: row.stock,
    locations: row.shelfLocations,
  }));
};

const buildFileName = (mode: ShelfExportMode, now: Date): string =>
  `shelf-locations-${mode}-${getThailandDateKey(now).replace(/-/g, "")}.xlsx`;

export async function GET(request: Request): Promise<Response> {
  const session = await requirePermission("stock.shelf_map.view");
  const requestContext = getRequestContextFromHeaders(request.headers);
  const { searchParams } = new URL(request.url);
  const mode = modeSchema.parse(searchParams.get("mode") ?? undefined);
  const filters = parseShelfMapFilters(toSearchParamRecord(searchParams));

  try {
    const [racks, names, productIds] = await Promise.all([
      db.shelfRack.findMany({
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        select: { id: true, code: true, name: true, levels: true, isActive: true },
      }),
      loadNameMaps(),
      resolveShelfFilterProductIds(filters),
    ]);
    const products = await loadExportProducts(filters, productIds, racks, names);
    const itemCount = countShelfExportRows(products);
    if (itemCount > MAX_EXPORT_ITEM_ROWS) {
      return textResponse(
        `ข้อมูลมีมากกว่า ${MAX_EXPORT_ITEM_ROWS.toLocaleString("en-US")} แถว กรุณากรองให้แคบลงแล้วส่งออกใหม่`,
        400,
      );
    }

    const now = new Date();
    const buffer = await buildShelfLocationWorkbook({
      mode,
      products,
      racks,
      filterDescription: describeShelfMapFilters(filters, names),
      printedAt: now,
    });
    const fileName = buildFileName(mode, now);

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.EXPORT,
      entityType: "ReportExport",
      entityRef: `shelf-locations-${mode}`,
      meta: {
        format: "xlsx",
        fileName,
        mode,
        rowCount: itemCount,
        productCount: products.length,
        filters: buildShelfMapFilterQuery(filters),
      },
    });

    return new Response(new Blob([buffer]), {
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[shelf-map] export failed", { mode, error });
    return textResponse("ส่งออกใบตรวจตำแหน่งไม่สำเร็จ กรุณาลองใหม่", 500);
  }
}
