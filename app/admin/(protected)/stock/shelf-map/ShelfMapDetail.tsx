import Link from "next/link";
import { PackageSearch } from "lucide-react";

import AdminEmptyState from "@/components/shared/AdminEmptyState";
import AdminSectionCard from "@/components/shared/AdminSectionCard";
import type { ShelfMapFilters } from "@/lib/shelf-map-filters";
import {
  groupShelfProductsByCategory,
  SHELF_CELL_LIST_LIMIT,
  SHELF_RESULT_LIST_LIMIT,
  type ShelfGridCell,
  type ShelfMapRack,
  type ShelfProductListItem,
} from "@/lib/shelf-map-queries";
import { clearSelectionHref, SHELF_GRID_HASH } from "./shelf-map-links";
import ShelfProductList from "./ShelfProductList";

export type ShelfMapDetailData =
  | { kind: "none" }
  | { kind: "missingCell"; code: string }
  | { kind: "cell"; cell: ShelfGridCell; rack: ShelfMapRack; items: ShelfProductListItem[]; capped: boolean }
  | { kind: "results"; rack: ShelfMapRack | null; items: ShelfProductListItem[]; total: number };

type Detail = ShelfMapDetailData;

type ShelfMapDetailProps = {
  detail: Detail;
  filters: ShelfMapFilters;
  canManage: boolean;
  canViewProducts: boolean;
  productFilterActive: boolean;
};

const formatCount = (value: number): string => value.toLocaleString("th-TH");

const sectionLinkCls =
  "inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-white/5";

const BackToGridLink = () => (
  <a href={SHELF_GRID_HASH} className={sectionLinkCls}>
    กลับไปที่ผัง
  </a>
);

const CellDetail = ({
  detail,
  filters,
  canManage,
  canViewProducts,
  productFilterActive,
}: Omit<ShelfMapDetailProps, "detail"> & { detail: Extract<Detail, { kind: "cell" }> }) => {
  const groups = groupShelfProductsByCategory(detail.items);
  const rackLabel = detail.rack.name ? `ชั้นวาง ${detail.rack.code} (${detail.rack.name})` : `ชั้นวาง ${detail.rack.code}`;
  const countLabel = detail.capped
    ? `แสดง ${formatCount(SHELF_CELL_LIST_LIMIT)} รายการแรกจาก ${formatCount(detail.cell.total)} รายการ`
    : `${formatCount(detail.items.length)} รายการ`;

  return (
    <AdminSectionCard
      className="overflow-visible"
      bodyClassName="p-0"
      title={
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-2xl font-bold text-[#1e3a5f] dark:text-sky-200">{detail.cell.code}</span>
          <span>สินค้าในช่องนี้</span>
        </span>
      }
      description={`${rackLabel} · ชั้น ${detail.cell.level} · ${countLabel}${filters.primaryOnly ? " · เฉพาะที่เก็บประจำ" : ""}`}
      actions={
        <>
          <BackToGridLink />
          <Link href={clearSelectionHref(filters)} prefetch={false} scroll={false} className={sectionLinkCls}>
            ล้างการเลือก
          </Link>
        </>
      }
    >
      {groups.length === 0 ? (
        <div className="p-4 sm:p-5">
          <AdminEmptyState
            title={productFilterActive ? "ไม่มีสินค้าที่ตรงกับที่ค้นหาในช่องนี้" : "ช่องนี้ยังไม่มีสินค้า"}
            description={filters.inStockOnly ? "กำลังแสดงเฉพาะสินค้าที่คงเหลือ > 0" : undefined}
          />
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.categoryName} className="border-t border-gray-100 first:border-t-0 dark:border-white/10">
            <h3 className="flex items-center justify-between gap-2 bg-gray-50 px-4 py-2 font-kanit text-sm font-semibold text-slate-700 dark:bg-white/5 dark:text-slate-200 sm:px-5">
              {group.categoryName}
              <span className="font-sarabun text-xs font-normal text-slate-500 dark:text-slate-400">
                {formatCount(group.items.length)} รายการ
              </span>
            </h3>
            <ShelfProductList
              items={group.items}
              canManage={canManage}
              canViewProducts={canViewProducts}
              showVerified
              showCategory={false}
            />
          </section>
        ))
      )}
    </AdminSectionCard>
  );
};

const ResultDetail = ({
  detail,
  filters,
  canManage,
  canViewProducts,
}: Omit<ShelfMapDetailProps, "detail" | "productFilterActive"> & { detail: Extract<Detail, { kind: "results" }> }) => {
  const title = detail.rack
    ? `สินค้าในชั้นวาง ${detail.rack.code}`
    : filters.location === "unlocated"
      ? "สินค้าที่ยังไม่มีที่เก็บ"
      : "ของอยู่ไหน";
  const capped = detail.total > detail.items.length;
  const description = capped
    ? `พบ ${formatCount(detail.total)} รายการ แสดง ${formatCount(SHELF_RESULT_LIST_LIMIT)} รายการแรก — ระบุคำค้นหรือตัวกรองให้แคบลงเพื่อดูส่วนที่เหลือ`
    : `พบ ${formatCount(detail.total)} รายการ`;

  return (
    <AdminSectionCard
      className="overflow-visible"
      bodyClassName="p-0"
      title={title}
      description={description}
      actions={
        <>
          <BackToGridLink />
          {detail.rack ? (
            <Link href={clearSelectionHref(filters)} prefetch={false} scroll={false} className={sectionLinkCls}>
              ล้างการเลือก
            </Link>
          ) : null}
        </>
      }
    >
      {detail.items.length === 0 ? (
        <div className="p-4 sm:p-5">
          <AdminEmptyState
            title="ไม่พบสินค้าที่ตรงกับเงื่อนไข"
            description={filters.inStockOnly ? "กำลังแสดงเฉพาะสินค้าที่คงเหลือ > 0 ลองเอาเครื่องหมาย \"เฉพาะคงเหลือ > 0\" ออก" : undefined}
          />
        </div>
      ) : (
        <ShelfProductList
          items={detail.items}
          canManage={canManage}
          canViewProducts={canViewProducts}
          showVerified={false}
          showCategory
        />
      )}
    </AdminSectionCard>
  );
};

/** The area under the grid: a selected cell, a rack or search results, or a hint. */
const ShelfMapDetail = (props: ShelfMapDetailProps) => {
  const { detail, filters } = props;
  if (detail.kind === "cell") return <CellDetail {...props} detail={detail} />;
  if (detail.kind === "results") return <ResultDetail {...props} detail={detail} />;
  if (detail.kind === "missingCell") {
    return (
      <AdminEmptyState
        title={`ไม่พบช่อง ${detail.code} ในผัง`}
        description="ชั้นวางนี้อาจถูกปิดใช้งาน หรือมีจำนวนชั้นน้อยกว่าที่ระบุ"
        actions={
          <Link href={clearSelectionHref(filters)} prefetch={false} className={sectionLinkCls}>
            ล้างการเลือก
          </Link>
        }
      />
    );
  }
  return (
    <AdminEmptyState
      icon={<PackageSearch size={20} />}
      title="แตะช่องในผังเพื่อดูสินค้าในช่องนั้น"
      description="หรือพิมพ์ชื่อ รหัส หรือรุ่นรถในช่องค้นหา เพื่อดูว่าของอยู่ชั้นวางไหน"
    />
  );
};

export default ShelfMapDetail;
