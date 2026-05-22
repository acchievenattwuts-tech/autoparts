/**
 * Phase Q5 — Match highlighting chips.
 *
 * Renders a small horizontal list of "why this product matched" chips.
 * Server-side `searchProductIds()` (lib/product-search.ts) returns a map of
 * productId → ProductMatchReason[]; pass that array as `reasons` here.
 */

import type { ProductMatchReason } from "@/lib/product-search";

interface Props {
  reasons: ProductMatchReason[] | undefined | null;
  /** Render chips in compact mode (smaller padding, tighter gap). */
  compact?: boolean;
}

interface ChipMeta {
  label: string;
  classes: string;
}

const CHIP_META: Record<ProductMatchReason, ChipMeta> = {
  code: {
    label: "ตรงรหัส",
    classes:
      "bg-indigo-50 text-indigo-700 border-indigo-100 " +
      "dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/30",
  },
  oem: {
    label: "ตรง OEM",
    classes:
      "bg-blue-50 text-blue-700 border-blue-100 " +
      "dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30",
  },
  year: {
    label: "ตรงรุ่น/ปี",
    classes:
      "bg-green-50 text-green-700 border-green-100 " +
      "dark:bg-green-500/10 dark:text-green-300 dark:border-green-500/30",
  },
  fitment: {
    label: "ตรงรุ่นรถ",
    classes:
      "bg-emerald-50 text-emerald-700 border-emerald-100 " +
      "dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30",
  },
  keyword: {
    label: "ตรงคำพ้อง",
    classes:
      "bg-amber-50 text-amber-700 border-amber-100 " +
      "dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30",
  },
  name: {
    label: "ตรงชื่อ",
    classes:
      "bg-slate-100 text-slate-700 border-slate-200 " +
      "dark:bg-slate-700/40 dark:text-slate-200 dark:border-slate-600",
  },
};

/** Display priority — most specific match shown first. */
const REASON_PRIORITY: ProductMatchReason[] = [
  "code",
  "oem",
  "year",
  "fitment",
  "keyword",
  "name",
];

const sortReasons = (reasons: ProductMatchReason[]): ProductMatchReason[] => {
  const set = new Set(reasons);
  return REASON_PRIORITY.filter((r) => set.has(r));
};

const ProductMatchChips = ({ reasons, compact = false }: Props) => {
  if (!reasons || reasons.length === 0) return null;

  const ordered = sortReasons(reasons);
  if (ordered.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center ${compact ? "gap-1" : "gap-1.5"}`}>
      {ordered.map((reason) => {
        const meta = CHIP_META[reason];
        return (
          <span
            key={reason}
            className={
              "inline-flex items-center rounded-full border font-medium " +
              (compact ? "px-1.5 py-0 text-[10px] leading-4" : "px-2 py-0.5 text-[11px]") +
              " " +
              meta.classes
            }
          >
            {meta.label}
          </span>
        );
      })}
    </div>
  );
};

export default ProductMatchChips;
