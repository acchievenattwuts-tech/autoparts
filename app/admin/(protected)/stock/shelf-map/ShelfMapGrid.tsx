import Link from "next/link";

import AdminSectionCard from "@/components/shared/AdminSectionCard";
import LinkPendingIndicator from "@/components/shared/LinkPendingIndicator";
import { buildShelfMapFilterQuery, type ShelfMapFilters } from "@/lib/shelf-map-filters";
import { formatShelfCellCategories, type ShelfGridCell, type ShelfGridModel } from "@/lib/shelf-map-queries";
import { cn } from "@/lib/utils";
import { clearSelectionHref, SHELF_DETAIL_HASH, SHELF_GRID_HASH, shelfMapHref } from "./shelf-map-links";

type ShelfMapGridProps = {
  model: ShelfGridModel;
  filters: ShelfMapFilters;
  productFilterActive: boolean;
};

const cellWidthCls = "w-[7.5rem] min-w-[7.5rem] sm:w-[8.5rem] sm:min-w-[8.5rem]";
const cellHeightCls = "h-[6.5rem]";
const stickyCls = "sticky left-0 bg-white dark:bg-slate-950";

const stockedCellCls =
  "border-emerald-200 bg-emerald-50 hover:border-emerald-400 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:hover:border-emerald-300/60";
const emptyCellCls =
  "border-dashed border-gray-300 bg-white hover:border-gray-400 dark:border-white/15 dark:bg-slate-900/40 dark:hover:border-white/30";

const legendDotCls = "inline-block h-3 w-3 rounded-sm border";

const ShelfCellState = ({ stocked }: { stocked: boolean }) => (
  <span
    className={cn(
      "shrink-0 rounded-full px-1.5 text-[10px] font-semibold leading-4",
      stocked
        ? "bg-emerald-600 text-white dark:bg-emerald-400/90 dark:text-emerald-950"
        : "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-slate-400",
    )}
  >
    {stocked ? "มีของ" : "ว่าง"}
  </span>
);

const cellCountLabel = (cell: ShelfGridCell, productFilterActive: boolean): string => {
  if (cell.total > 0) return `${cell.total.toLocaleString("th-TH")} รายการ`;
  return productFilterActive ? "ไม่ตรงเงื่อนไข" : "ไม่มีสินค้า";
};

const ShelfCellLink = ({
  cell,
  href,
  isSelected,
  productFilterActive,
}: {
  cell: ShelfGridCell;
  href: string;
  isSelected: boolean;
  productFilterActive: boolean;
}) => {
  const matched = cell.total > 0;
  const stocked = cell.inStock > 0;
  const muted = productFilterActive && !matched;
  const categories = formatShelfCellCategories(cell);

  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={isSelected ? "location" : undefined}
      aria-label={`ช่อง ${cell.code} ${cellCountLabel(cell, productFilterActive)}${stocked ? " มีของ" : " ว่าง"}`}
      className={cn(
        "relative flex w-full flex-col gap-1 overflow-hidden rounded-lg border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1e3a5f] dark:focus-visible:ring-sky-400",
        cellHeightCls,
        stocked ? stockedCellCls : emptyCellCls,
        productFilterActive && matched && "ring-2 ring-[#f97316] dark:ring-orange-400",
        muted && "opacity-40 hover:opacity-70",
        isSelected && "outline outline-2 outline-offset-2 outline-[#1e3a5f] dark:outline-sky-300",
      )}
    >
      <span className="flex items-start justify-between gap-1">
        <span
          className={cn(
            "font-mono text-lg font-bold leading-6 tracking-tight",
            stocked ? "text-[#1e3a5f] dark:text-sky-100" : "text-gray-500 dark:text-slate-400",
          )}
        >
          {cell.code}
        </span>
        {!muted && <ShelfCellState stocked={stocked} />}
      </span>
      <span
        className={cn(
          "text-xs font-medium",
          matched ? "text-slate-700 dark:text-slate-200" : "text-gray-400 dark:text-slate-500",
        )}
      >
        {cellCountLabel(cell, productFilterActive)}
      </span>
      {categories ? (
        <span className="line-clamp-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400">{categories}</span>
      ) : null}
      <LinkPendingIndicator className="absolute bottom-1.5 right-1.5 ml-0 text-[#1e3a5f] dark:text-sky-300" />
    </Link>
  );
};

const ShelfMapLegend = ({ productFilterActive }: { productFilterActive: boolean }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
    <span className="inline-flex items-center gap-1.5">
      <span className={cn(legendDotCls, "border-emerald-300 bg-emerald-100 dark:border-emerald-400/40 dark:bg-emerald-500/20")} />
      มีของ
    </span>
    <span className="inline-flex items-center gap-1.5">
      <span className={cn(legendDotCls, "border-dashed border-gray-400 bg-white dark:border-white/30 dark:bg-slate-900")} />
      ว่าง
    </span>
    {productFilterActive ? (
      <span className="inline-flex items-center gap-1.5">
        <span className={cn(legendDotCls, "border-2 border-[#f97316] dark:border-orange-400")} />
        ตรงกับที่ค้นหา
      </span>
    ) : null}
  </div>
);

const ShelfMapGrid = ({ model, filters, productFilterActive }: ShelfMapGridProps) => {
  const clearHref = clearSelectionHref(filters);
  const selectedRackOnly = filters.rackCode && filters.level === null ? filters.rackCode : "";
  const isSelectedCell = (cell: ShelfGridCell): boolean =>
    cell.rackCode === filters.rackCode && cell.level === filters.level;

  // Clicking the selected cell again clears the selection; any other cell opens its list below.
  const cellHref = (cell: ShelfGridCell): string =>
    isSelectedCell(cell)
      ? clearHref
      : shelfMapHref(buildShelfMapFilterQuery(filters, { rackCode: cell.rackCode, level: cell.level }), SHELF_DETAIL_HASH);

  // A rack drill-down lists what is in the rack, so it drops "ยังไม่มีที่เก็บ".
  const rackLocation = filters.location === "unlocated" ? "all" : filters.location;
  const rackHref = (rackCode: string): string =>
    rackCode === selectedRackOnly
      ? clearHref
      : shelfMapHref(buildShelfMapFilterQuery(filters, { rackCode, level: null, location: rackLocation }), SHELF_DETAIL_HASH);

  const description = productFilterActive
    ? `ตรงกับที่ค้นหา ${model.matchedCellCount.toLocaleString("th-TH")} จาก ${model.cellCount.toLocaleString("th-TH")} ช่อง`
    : `${model.racks.length.toLocaleString("th-TH")} ชั้นวาง · ${model.cellCount.toLocaleString("th-TH")} ช่อง · มีของ ${model.stockedCellCount.toLocaleString("th-TH")} ช่อง — แตะช่องเพื่อดูสินค้า แตะรหัสชั้นวางเพื่อดูทั้งชั้นวาง`;

  return (
    <div id={SHELF_GRID_HASH.slice(1)} className="scroll-mt-4">
      <AdminSectionCard
        title="ผังชั้นวาง"
        description={description}
        actions={<ShelfMapLegend productFilterActive={productFilterActive} />}
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto overscroll-x-contain pb-3">
          <table className="border-separate border-spacing-0">
            <thead>
              <tr>
                <th scope="col" className={cn(stickyCls, "z-20 px-2 pb-1 pt-3")}>
                  <span className="sr-only">ชั้น</span>
                </th>
                {model.racks.map((rack) => {
                  const isSelected = rack.code === selectedRackOnly;
                  return (
                    <th key={rack.id} scope="col" className={cn(cellWidthCls, "px-1 pb-1 pt-3 align-bottom font-normal")}>
                      <Link
                        href={rackHref(rack.code)}
                        prefetch={false}
                        aria-current={isSelected ? "location" : undefined}
                        title={rack.name ? `ชั้นวาง ${rack.code} · ${rack.name}` : `ชั้นวาง ${rack.code}`}
                        className={cn(
                          "relative block rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1e3a5f] dark:hover:bg-white/5 dark:focus-visible:ring-sky-400",
                          isSelected && "bg-[#1e3a5f]/10 outline outline-2 outline-[#1e3a5f] dark:bg-sky-500/15 dark:outline-sky-300",
                        )}
                      >
                        <span className="block font-mono text-xl font-bold leading-7 text-[#1e3a5f] dark:text-sky-200">
                          {rack.code}
                        </span>
                        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                          {rack.name ?? `${rack.levels} ชั้น`}
                        </span>
                        <LinkPendingIndicator className="absolute right-1.5 top-1.5 ml-0 text-[#1e3a5f] dark:text-sky-300" />
                      </Link>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {model.rows.map((row) => (
                <tr key={row.level}>
                  <th
                    scope="row"
                    className={cn(stickyCls, "z-10 whitespace-nowrap px-2 py-1 text-left align-middle sm:px-3")}
                  >
                    <span className="font-kanit text-sm font-medium text-slate-600 dark:text-slate-300">ชั้น {row.level}</span>
                  </th>
                  {row.cells.map((cell, index) => (
                    <td key={model.racks[index]?.id ?? index} className={cn(cellWidthCls, "p-1 align-top")}>
                      {cell ? (
                        <ShelfCellLink
                          cell={cell}
                          href={cellHref(cell)}
                          isSelected={isSelectedCell(cell)}
                          productFilterActive={productFilterActive}
                        />
                      ) : (
                        <div aria-hidden="true" className={cn(cellHeightCls, "rounded-lg bg-gray-50 dark:bg-white/[0.03]")} />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminSectionCard>
    </div>
  );
};

export default ShelfMapGrid;
