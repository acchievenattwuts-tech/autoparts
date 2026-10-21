export const dynamic = "force-dynamic";

import Link from "next/link";
import { MapPin, PackageCheck, Settings2 } from "lucide-react";

import AdminEmptyState from "@/components/shared/AdminEmptyState";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import LinkPendingIndicator from "@/components/shared/LinkPendingIndicator";
import Pagination from "@/components/shared/Pagination";
import { getAdminProductFilterOptions, type AdminProductFilterOptions } from "@/lib/admin-master-options";
import { requirePermission } from "@/lib/require-auth";
import { parseShelfMapFilters, resolveShelfFilterProductIds, type ShelfSearchParams } from "@/lib/shelf-map-filters";
import { loadShelfMapRacks, type ShelfMapRack } from "@/lib/shelf-map-queries";
import {
  buildPutAwayQuery,
  hasPutAwayProductFilters,
  loadPutAwayCounts,
  loadPutAwayPage,
  parsePutAwayFilters,
  PUT_AWAY_PAGE_SIZE,
  type PutAwayCounts,
  type PutAwayFilters,
  type PutAwayItem,
  type PutAwayTab,
} from "@/lib/shelf-put-away";
import { getThailandDateKey } from "@/lib/th-date";
import { cn } from "@/lib/utils";
import PutAwayFilterForm from "./PutAwayFilterForm";
import PutAwayList from "./PutAwayList";

type PutAwayPageProps = { searchParams: Promise<ShelfSearchParams> };

const PUT_AWAY_PATH = "/admin/stock/put-away";

const headerLinkCls =
  "inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-white/5";

const TABS: ReadonlyArray<{ tab: PutAwayTab; label: string; hint: string }> = [
  {
    tab: "unlocated",
    label: "ยังไม่มีที่เก็บ",
    hint: "สินค้าที่มีของแต่ยังไม่ได้ระบุตำแหน่ง เรียงจากรับเข้าล่าสุด เลือกชั้นวางและชั้นแล้วบันทึก ตำแหน่งแรกจะเป็นที่เก็บประจำ",
  },
  {
    tab: "received",
    label: "รับเข้าใหม่ — ยืนยันที่เก็บ",
    hint: "สินค้าที่รับเข้าหลังวันที่ยืนยันตำแหน่งครั้งล่าสุด วางที่เดิมกด \"เก็บที่เดิม\" ถ้าวางที่อื่นกด \"ที่อื่น…\"",
  },
];

const hrefFor = (filters: PutAwayFilters, overrides: Partial<PutAwayFilters> = {}): string => {
  const query = buildPutAwayQuery(filters, overrides);
  return query ? `${PUT_AWAY_PATH}?${query}` : PUT_AWAY_PATH;
};

type PutAwayData = {
  racks: ShelfMapRack[];
  counts: PutAwayCounts;
  items: PutAwayItem[];
  filterOptions: AdminProductFilterOptions;
};

const loadPutAwayData = async (params: ShelfSearchParams, filters: PutAwayFilters): Promise<PutAwayData> => {
  const [racks, filterOptions, productIds] = await Promise.all([
    loadShelfMapRacks(),
    getAdminProductFilterOptions(),
    resolveShelfFilterProductIds(parseShelfMapFilters(params)),
  ]);
  const queue = { productIds, receivedFrom: filters.receivedFrom, receivedTo: filters.receivedTo };
  const carBrandNames = new Map(filterOptions.carBrands.map((brand) => [brand.id, brand.name]));
  const [counts, items] = await Promise.all([
    loadPutAwayCounts(queue),
    loadPutAwayPage({ ...queue, tab: filters.tab, page: filters.page, carBrandNames }),
  ]);
  return { racks, counts, items, filterOptions };
};

const PutAwayTabs = ({ filters, counts }: { filters: PutAwayFilters; counts: PutAwayCounts }) => (
  <div
    role="tablist"
    aria-label="รายการรอตั้งที่เก็บ"
    className="flex overflow-x-auto rounded-xl border border-gray-200 bg-white px-2 shadow-sm dark:border-white/10 dark:bg-slate-950/80"
  >
    {TABS.map(({ tab, label }) => {
      const active = filters.tab === tab;
      return (
        <Link
          key={tab}
          href={hrefFor(filters, { tab, page: 1 })}
          prefetch={false}
          role="tab"
          aria-selected={active}
          aria-current={active ? "page" : undefined}
          className={cn(
            "relative inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
            active
              ? "border-[#1e3a5f] text-[#1e3a5f] dark:border-sky-400 dark:text-sky-200"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
          )}
        >
          <span>{label}</span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
              counts[tab] > 0
                ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200"
                : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
            )}
          >
            {counts[tab].toLocaleString("th-TH")}
          </span>
          <LinkPendingIndicator className="ml-0" />
        </Link>
      );
    })}
  </div>
);

const EmptyTab = ({ tab, filtered }: { tab: PutAwayTab; filtered: boolean }) => {
  if (filtered) {
    return <AdminEmptyState icon={<PackageCheck size={20} />} title="ไม่พบสินค้าตามตัวกรอง" description="ลองล้างตัวกรองหรือเปลี่ยนช่วงวันที่" />;
  }
  return tab === "unlocated" ? (
    <AdminEmptyState
      icon={<PackageCheck size={20} />}
      title="สินค้าที่มีของระบุที่เก็บครบแล้ว"
      description="เมื่อรับสินค้าตัวใหม่ที่ยังไม่มีตำแหน่ง รายการจะขึ้นที่นี่"
    />
  ) : (
    <AdminEmptyState
      icon={<PackageCheck size={20} />}
      title="ไม่มีสินค้ารับเข้าใหม่ที่ต้องยืนยันที่เก็บ"
      description="สินค้าที่มีตำแหน่งแล้วและรับเข้าหลังวันที่ยืนยันตำแหน่งครั้งล่าสุด จะขึ้นที่นี่"
    />
  );
};

const PutAwayPage = async ({ searchParams }: PutAwayPageProps) => {
  await requirePermission("stock.shelf_map.manage");

  const params = await searchParams;
  const filters = parsePutAwayFilters(params);
  const filtered = hasPutAwayProductFilters(filters) || Boolean(filters.receivedFrom || filters.receivedTo);

  let data: PutAwayData | null = null;
  try {
    data = await loadPutAwayData(params, filters);
  } catch (error) {
    console.error("[put-away] page load failed", { query: buildPutAwayQuery(filters), error });
  }

  const tabInfo = TABS.find((item) => item.tab === filters.tab) ?? TABS[0];
  const total = data?.counts[filters.tab] ?? 0;

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="ตั้งที่เก็บสินค้า"
        description="ระบุว่าสินค้าที่รับเข้ามาเก็บไว้ชั้นวางไหน ชั้นไหน ตำแหน่งเขียนเป็น A-2 คือชั้นวาง A ชั้นที่ 2 นับจากล่าง"
        actions={
          <Link href="/admin/stock/shelf-map" className={headerLinkCls}>
            <MapPin size={16} />
            ผังชั้นวาง
          </Link>
        }
      />

      {data === null ? (
        <AdminEmptyState title="โหลดรายการไม่สำเร็จ" description="กรุณาโหลดหน้าใหม่อีกครั้ง" />
      ) : data.racks.length === 0 ? (
        <AdminEmptyState
          icon={<MapPin size={20} />}
          title="ยังไม่มีชั้นวางที่ใช้งาน"
          description="เพิ่มชั้นวางและจำนวนชั้นก่อน แล้วจึงตั้งที่เก็บให้สินค้า"
          actions={
            <Link href="/admin/stock/shelf-map/racks" className={headerLinkCls}>
              <Settings2 size={16} />
              ตั้งค่าชั้นวาง
            </Link>
          }
        />
      ) : (
        <>
          <PutAwayTabs filters={filters} counts={data.counts} />
          <p className="px-1 text-sm text-slate-500 dark:text-slate-400">{tabInfo.hint}</p>

          <PutAwayFilterForm
            values={{
              tab: filters.tab,
              q: filters.q,
              categoryIds: filters.categoryIds,
              brandId: filters.brandId,
              carBrandId: filters.carBrandId,
              receivedFrom: filters.receivedFrom,
              receivedTo: filters.receivedTo,
            }}
            categories={data.filterOptions.categories}
            partsBrands={data.filterOptions.partsBrands}
            carBrands={data.filterOptions.carBrands.map(({ id, name }) => ({ id, name }))}
            todayKey={getThailandDateKey()}
            clearHref={hrefFor({ ...filters, q: "", categoryIds: [], brandId: "", carBrandId: "", receivedFrom: "", receivedTo: "", page: 1 })}
            hasActiveFilters={filtered}
          />

          {data.items.length === 0 ? (
            <EmptyTab tab={filters.tab} filtered={filtered} />
          ) : (
            <PutAwayList
              key={`${filters.tab}:${filters.page}`}
              items={data.items}
              tab={filters.tab}
              racks={data.racks}
            />
          )}

          <Pagination
            currentPage={filters.page}
            totalPages={Math.ceil(total / PUT_AWAY_PAGE_SIZE)}
            buildHref={(page) => hrefFor(filters, { page })}
          />
        </>
      )}
    </div>
  );
};

export default PutAwayPage;
