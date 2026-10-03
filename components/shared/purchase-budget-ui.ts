import type { PurchaseBudgetLevel } from "@/lib/purchase-budget-core";

export { formatBaht, formatPercent, formatSignedBaht } from "@/lib/purchase-budget-format";

/** Display helpers shared by the Purchase Budget tab components (light + dark classes together). */

export type BudgetStatusStyle = {
  label: string;
  chip: string;
  fill: string;
  track: string;
  message: string;
};

export const BUDGET_STATUS_STYLE: Record<PurchaseBudgetLevel | "unset", BudgetStatusStyle> = {
  ok: {
    label: "ปกติ",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300",
    fill: "bg-emerald-600",
    track: "bg-emerald-100 dark:bg-emerald-900",
    message: "text-emerald-700 dark:text-emerald-300",
  },
  low: {
    label: "ใกล้หมด",
    chip: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300",
    fill: "bg-amber-600",
    track: "bg-amber-100 dark:bg-amber-900",
    message: "text-amber-700 dark:text-amber-300",
  },
  over: {
    label: "เกินงบ",
    chip: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-300",
    fill: "bg-rose-600",
    track: "bg-rose-100 dark:bg-rose-900",
    message: "text-rose-700 dark:text-rose-300",
  },
  unset: {
    label: "ยังไม่ตั้งงบ",
    chip: "border-slate-200 bg-slate-100 text-slate-600 dark:border-white/15 dark:bg-white/5 dark:text-slate-300",
    fill: "bg-slate-400",
    track: "bg-slate-200 dark:bg-slate-800",
    message: "text-slate-600 dark:text-slate-300",
  },
};

export const BUDGET_SECTION_CLASS =
  "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#0d1728]";
export const BUDGET_PANEL_CLASS = "rounded-xl border border-slate-200 p-3 sm:p-4 dark:border-white/10";
export const BUDGET_MUTED_PANEL_CLASS =
  "rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4 dark:border-white/10 dark:bg-white/5";
export const BUDGET_PANEL_TITLE_CLASS = "text-sm font-semibold text-slate-600 dark:text-slate-300";
export const BUDGET_ROW_CLASS =
  "flex items-baseline justify-between gap-3 border-b border-slate-100 py-1.5 text-sm last:border-b-0 dark:border-white/10";
