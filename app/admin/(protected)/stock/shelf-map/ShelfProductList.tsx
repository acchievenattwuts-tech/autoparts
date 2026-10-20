import Link from "next/link";
import { Eye } from "lucide-react";

import ShelfLocationBadgeMenu from "@/components/shared/ShelfLocationBadgeMenu";
import ShelfLocationBadges from "@/components/shared/ShelfLocationBadges";
import type { ShelfProductListItem } from "@/lib/shelf-map-queries";
import { formatDateThai } from "@/lib/th-date";
import { cn } from "@/lib/utils";

type ShelfProductListProps = {
  items: readonly ShelfProductListItem[];
  canManage: boolean;
  canViewProducts: boolean;
  /** Show "ตรวจล่าสุด" (the selected cell's verifiedAt) — cell detail only. */
  showVerified: boolean;
  /** Show the category under the name — the ungrouped result list only. */
  showCategory: boolean;
};

// Two literal templates so Tailwind sees both.
const gridWithVerifiedCls = "md:grid-cols-[minmax(0,1fr)_minmax(0,13rem)_5.5rem_6.5rem_3.5rem]";
const gridWithoutVerifiedCls = "md:grid-cols-[minmax(0,1fr)_minmax(0,15rem)_5.5rem_3.5rem]";
const headerCellCls = "text-xs font-medium text-gray-500 dark:text-slate-400";

const PreviewLink = ({ productId }: { productId: string }) => (
  <Link
    href={`/admin/products/${productId}/preview`}
    prefetch={false}
    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-white/5"
  >
    <Eye size={12} />
    ดู
  </Link>
);

const ShelfProductRow = ({
  item,
  canManage,
  canViewProducts,
  showVerified,
  showCategory,
}: Omit<ShelfProductListProps, "items"> & { item: ShelfProductListItem }) => {
  const subline = [item.brandName, showCategory ? item.categoryName : null].filter(Boolean).join(" · ");
  return (
    <li
      className={cn(
        "flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-slate-50/70 dark:hover:bg-white/5 sm:px-5 md:grid md:items-center md:gap-3",
        showVerified ? gridWithVerifiedCls : gridWithoutVerifiedCls,
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold text-slate-500 dark:text-slate-400">{item.code}</p>
          <p className="break-words font-medium leading-6 text-slate-900 dark:text-slate-100">{item.name}</p>
          {subline ? <p className="text-xs text-slate-400 dark:text-slate-500">{subline}</p> : null}
        </div>
        {canViewProducts ? (
          <div className="md:hidden">
            <PreviewLink productId={item.id} />
          </div>
        ) : null}
      </div>

      <div className="min-w-0">
        {canManage ? (
          <ShelfLocationBadgeMenu productId={item.id} locations={item.locations} size="md" />
        ) : (
          <ShelfLocationBadges locations={item.locations} size="md" />
        )}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm md:contents">
        <p className="md:text-right">
          <span className="text-xs text-slate-400 dark:text-slate-500 md:hidden">คงเหลือ </span>
          <span
            className={cn(
              "font-semibold tabular-nums",
              item.stock > 0 ? "text-slate-900 dark:text-slate-100" : "text-rose-600 dark:text-rose-300",
            )}
          >
            {item.stock.toLocaleString("th-TH")}
          </span>{" "}
          <span className="text-xs text-slate-400 dark:text-slate-500">{item.unitName}</span>
        </p>
        {showVerified ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <span className="md:hidden">ตรวจล่าสุด </span>
            {item.verifiedAt ? formatDateThai(item.verifiedAt) : <span className="text-amber-600 dark:text-amber-300">ยังไม่ตรวจ</span>}
          </p>
        ) : null}
      </div>

      <div className="hidden md:flex md:justify-end">{canViewProducts ? <PreviewLink productId={item.id} /> : null}</div>
    </li>
  );
};

/** Product rows with every location as badges; staff with manage rights get the badge actions. */
const ShelfProductList = ({ items, ...rowProps }: ShelfProductListProps) => (
  <div>
    <div
      className={cn(
        "hidden border-b border-gray-100 bg-gray-50/60 px-5 py-2 dark:border-white/10 dark:bg-white/[0.03] md:grid md:gap-3",
        rowProps.showVerified ? gridWithVerifiedCls : gridWithoutVerifiedCls,
      )}
    >
      <span className={headerCellCls}>สินค้า</span>
      <span className={headerCellCls}>ที่เก็บ</span>
      <span className={cn(headerCellCls, "text-right")}>คงเหลือ</span>
      {rowProps.showVerified ? <span className={headerCellCls}>ตรวจล่าสุด</span> : null}
      <span className="sr-only">ดูสินค้า</span>
    </div>
    <ul className="divide-y divide-gray-100 dark:divide-white/10">
      {items.map((item) => (
        <ShelfProductRow key={item.id} item={item} {...rowProps} />
      ))}
    </ul>
  </div>
);

export default ShelfProductList;
