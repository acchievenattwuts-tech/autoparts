export const dynamic = "force-dynamic";

import Link from "next/link";
import { ClipboardCheck, ClipboardList, FileUp, MapPin, PackageSearch, Settings2 } from "lucide-react";

import AdminEmptyState from "@/components/shared/AdminEmptyState";
import AdminExportLink from "@/components/shared/AdminExportLink";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminStatCard from "@/components/shared/AdminStatCard";
import { getAllPermissionKeys, hasPermissionAccess } from "@/lib/access-control";
import {
  getAdminProductFilterOptions,
  getAllCategoryFilterOptions,
  type AdminProductFilterOptions,
} from "@/lib/admin-master-options";
import { getSession } from "@/lib/auth-session";
import { requirePermission } from "@/lib/require-auth";
import {
  buildShelfMapFilterQuery,
  describeShelfMapFilters,
  hasProductFilters,
  parseShelfMapFilters,
  resolveShelfFilterProductIds,
  type ShelfMapFilters,
  type ShelfSearchParams,
} from "@/lib/shelf-map-filters";
import {
  buildShelfGridModel,
  findShelfGridCell,
  loadShelfCellAggregates,
  loadShelfCellProducts,
  loadShelfMapRacks,
  loadShelfMapStats,
  loadShelfResultList,
  type ShelfGridModel,
  type ShelfMapRack,
  type ShelfMapStats,
  type ShelfProductListItem,
} from "@/lib/shelf-map-queries";
import { SHELF_DETAIL_HASH, shelfMapHref } from "./shelf-map-links";
import ShelfMapDetail, { type ShelfMapDetailData } from "./ShelfMapDetail";
import ShelfMapFilterForm from "./ShelfMapFilterForm";
import ShelfMapGrid from "./ShelfMapGrid";

type ShelfMapPageProps = { searchParams: Promise<ShelfSearchParams> };

const formatCount = (value: number): string => value.toLocaleString("th-TH");

const headerLinkCls =
  "inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-white/5";
const exportLinkCls =
  "inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 dark:bg-emerald-600 dark:hover:bg-emerald-500";

type Detail = ShelfMapDetailData;

type ShelfMapData = {
  racks: ShelfMapRack[];
  stats: ShelfMapStats;
  grid: ShelfGridModel;
  detail: Detail;
  filterOptions: AdminProductFilterOptions;
  categoryNames: Map<string, string>;
};

type Selection =
  | { kind: "none" }
  | { kind: "missing"; code: string }
  | { kind: "cell"; rack: ShelfMapRack; level: number }
  | { kind: "results"; rack: ShelfMapRack | null };

/** What the detail area shows: a cell, a rack or search results, the empty hint, or a stale link. */
const resolveSelection = (filters: ShelfMapFilters, racks: readonly ShelfMapRack[]): Selection => {
  const rack = filters.rackCode ? racks.find((item) => item.code === filters.rackCode) : undefined;
  if (filters.rackCode && filters.level !== null) {
    if (!rack || filters.level > rack.levels) return { kind: "missing", code: `${filters.rackCode}-${filters.level}` };
    return { kind: "cell", rack, level: filters.level };
  }
  if (filters.rackCode && !rack) return { kind: "missing", code: filters.rackCode };
  const showResults = hasProductFilters(filters) || filters.location !== "all" || Boolean(rack);
  return showResults ? { kind: "results", rack: rack ?? null } : { kind: "none" };
};

type DetailRows =
  | { kind: "cell"; items: ShelfProductListItem[]; capped: boolean }
  | { kind: "results"; items: ShelfProductListItem[]; total: number }
  | null;

const loadDetailRows = async (
  selection: Selection,
  filters: ShelfMapFilters,
  productIds: string[] | null,
): Promise<DetailRows> => {
  const common = { productIds, primaryOnly: filters.primaryOnly, inStockOnly: filters.inStockOnly };
  if (selection.kind === "cell") {
    const rows = await loadShelfCellProducts({ ...common, rackId: selection.rack.id, level: selection.level });
    return { kind: "cell", ...rows };
  }
  if (selection.kind === "results") {
    // A rack drill-down lists what is in the rack, so "ยังไม่มีที่เก็บ" cannot apply to it.
    const location = selection.rack && filters.location === "unlocated" ? "all" : filters.location;
    const rows = await loadShelfResultList({ ...common, location, rackId: selection.rack?.id ?? null });
    return { kind: "results", ...rows };
  }
  return null;
};

const toDetail = (selection: Selection, rows: DetailRows, grid: ShelfGridModel): Detail => {
  if (selection.kind === "missing") return { kind: "missingCell", code: selection.code };
  if (selection.kind === "cell" && rows?.kind === "cell") {
    const cell = findShelfGridCell(grid, selection.rack.code, selection.level);
    if (!cell) return { kind: "missingCell", code: `${selection.rack.code}-${selection.level}` };
    return { kind: "cell", cell, rack: selection.rack, items: rows.items, capped: rows.capped };
  }
  if (selection.kind === "results" && rows?.kind === "results") {
    return { kind: "results", rack: selection.rack, items: rows.items, total: rows.total };
  }
  return { kind: "none" };
};

const loadShelfMapData = async (filters: ShelfMapFilters): Promise<ShelfMapData> => {
  const [racks, stats, filterOptions, allCategories, productIds] = await Promise.all([
    loadShelfMapRacks(),
    loadShelfMapStats(),
    getAdminProductFilterOptions(),
    getAllCategoryFilterOptions(),
    resolveShelfFilterProductIds(filters),
  ]);
  const categoryNames = new Map(allCategories.map((category) => [category.id, category.name]));
  const selection = resolveSelection(filters, racks);
  const [aggregates, detailRows] = await Promise.all([
    loadShelfCellAggregates({ productIds, primaryOnly: filters.primaryOnly, inStockOnly: filters.inStockOnly }),
    loadDetailRows(selection, filters, productIds),
  ]);
  const grid = buildShelfGridModel(racks, aggregates, categoryNames);
  return { racks, stats, grid, detail: toDetail(selection, detailRows, grid), filterOptions, categoryNames };
};

const describeActiveFilters = (filters: ShelfMapFilters, data: ShelfMapData): string | undefined => {
  const nonDefault =
    hasProductFilters(filters) || filters.location !== "all" || filters.primaryOnly || !filters.inStockOnly;
  if (!nonDefault) return undefined;
  const names = {
    categories: data.categoryNames,
    partsBrands: new Map(data.filterOptions.partsBrands.map((brand) => [brand.id, brand.name])),
    carBrands: new Map(data.filterOptions.carBrands.map((brand) => [brand.id, brand.name])),
  };
  return `กำลังแสดง: ${describeShelfMapFilters({ ...filters, rackCode: "", level: null }, names)}`;
};

type ShelfMapStatRowProps = { stats: ShelfMapStats; racks: number; cellCount: number; unlocatedHref: string };

const ShelfMapStatRow = ({ stats, racks, cellCount, unlocatedHref }: ShelfMapStatRowProps) => (
  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
    <AdminStatCard
      label="ชั้นวางที่ใช้งาน"
      value={formatCount(racks)}
      hint={`รวม ${formatCount(cellCount)} ช่อง`}
      icon={<MapPin size={18} />}
    />
    <AdminStatCard
      label="สินค้าที่มีที่เก็บ"
      value={formatCount(stats.locatedProducts)}
      hint="สินค้าที่ใช้งานอยู่และระบุตำแหน่งแล้ว"
      accent="success"
    />
    <Link
      href={unlocatedHref}
      prefetch={false}
      className="block rounded-xl transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1e3a5f] dark:focus-visible:ring-sky-400"
    >
      <AdminStatCard
        label="ยังไม่มีที่เก็บ"
        value={formatCount(stats.unlocatedInStock)}
        hint="มีของแต่ยังไม่ได้ระบุตำแหน่ง — แตะเพื่อดูรายการ"
        accent={stats.unlocatedInStock > 0 ? "warning" : "success"}
        icon={<PackageSearch size={18} />}
        className="h-full"
      />
    </Link>
    <AdminStatCard
      label="ที่เก็บเพิ่มทั้งหมด"
      value={formatCount(stats.secondaryLocations)}
      hint="ตำแหน่งของที่ล้นจากที่เก็บประจำ"
      accent="info"
    />
  </div>
);

const NoRacksState = ({ canManage }: { canManage: boolean }) => (
  <AdminEmptyState
    icon={<MapPin size={20} />}
    title="ยังไม่มีชั้นวางที่ใช้งาน"
    description="เพิ่มชั้นวางและจำนวนชั้นก่อน แล้วจึงระบุว่าสินค้าแต่ละชิ้นเก็บอยู่ที่ไหน"
    actions={
      canManage ? (
        <Link href="/admin/stock/shelf-map/racks" className={headerLinkCls}>
          <Settings2 size={16} />
          ตั้งค่าชั้นวาง
        </Link>
      ) : null
    }
  />
);

const ShelfMapPage = async ({ searchParams }: ShelfMapPageProps) => {
  await requirePermission("stock.shelf_map.view");

  const session = await getSession();
  const role = session?.user?.role;
  const permissions = role === "ADMIN" ? getAllPermissionKeys() : (session?.user?.permissions ?? []);
  const canManage = hasPermissionAccess(role, permissions, "stock.shelf_map.manage");
  const canViewProducts = hasPermissionAccess(role, permissions, "products.view");

  const filters = parseShelfMapFilters(await searchParams);
  const productFilterActive = hasProductFilters(filters);
  const filterQuery = buildShelfMapFilterQuery(filters);
  const exportQuery = (mode: "survey" | "recheck"): string =>
    `/admin/stock/shelf-map/export?mode=${mode}${filterQuery ? `&${filterQuery}` : ""}`;

  let data: ShelfMapData | null = null;
  try {
    data = await loadShelfMapData(filters);
  } catch (error) {
    console.error("[shelf-map] page load failed", { filterQuery, error });
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="ผังชั้นวาง"
        description="ดูว่าสินค้าอยู่ชั้นวางไหน ชั้นไหน ตำแหน่งเขียนเป็น A-2 คือชั้นวาง A ชั้นที่ 2 นับจากล่าง"
        actions={
          <>
            <Link href="/admin/stock/shelf-map/racks" className={headerLinkCls}>
              <Settings2 size={16} />
              ตั้งค่าชั้นวาง
            </Link>
            <AdminExportLink href={exportQuery("survey")} className={exportLinkCls}>
              <ClipboardList size={16} />
              ใบสำรวจครั้งแรก
            </AdminExportLink>
            <AdminExportLink href={exportQuery("recheck")} className={exportLinkCls}>
              <ClipboardCheck size={16} />
              ใบตรวจซ้ำ
            </AdminExportLink>
            {canManage ? (
              <Link
                href="/admin/stock/shelf-map/import"
                prefetch={false}
                className="inline-flex items-center gap-2 rounded-lg bg-[#f97316] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
              >
                <FileUp size={16} />
                นำเข้า Excel
              </Link>
            ) : null}
          </>
        }
      />

      {data === null ? (
        <AdminEmptyState title="โหลดผังชั้นวางไม่สำเร็จ" description="กรุณาโหลดหน้าใหม่อีกครั้ง" />
      ) : (
        <>
          <ShelfMapStatRow
            stats={data.stats}
            racks={data.racks.length}
            cellCount={data.grid.cellCount}
            unlocatedHref={shelfMapHref(
              buildShelfMapFilterQuery(filters, { location: "unlocated", rackCode: "", level: null }),
              SHELF_DETAIL_HASH,
            )}
          />

          <ShelfMapFilterForm
            values={{
              q: filters.q,
              categoryIds: filters.categoryIds,
              brandId: filters.brandId,
              carBrandId: filters.carBrandId,
              location: filters.location,
              primaryOnly: filters.primaryOnly,
              inStockOnly: filters.inStockOnly,
            }}
            categories={data.filterOptions.categories}
            partsBrands={data.filterOptions.partsBrands}
            carBrands={data.filterOptions.carBrands.map(({ id, name }) => ({ id, name }))}
            hasActiveFilters={Boolean(filterQuery)}
            summary={describeActiveFilters(filters, data)}
          />

          {data.racks.length === 0 ? (
            <NoRacksState canManage={canManage} />
          ) : (
            <>
              <ShelfMapGrid model={data.grid} filters={filters} productFilterActive={productFilterActive} />
              <div id={SHELF_DETAIL_HASH.slice(1)} className="scroll-mt-4">
                <ShelfMapDetail
                  detail={data.detail}
                  filters={filters}
                  canManage={canManage}
                  canViewProducts={canViewProducts}
                  productFilterActive={productFilterActive}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default ShelfMapPage;
