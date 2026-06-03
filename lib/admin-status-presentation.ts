import { cn } from "@/lib/utils";

export const ADMIN_ACTIVE_ROW_CLASS =
  "hover:bg-slate-50/70 dark:hover:bg-white/5";

export const ADMIN_CANCELLED_ROW_CLASS =
  "bg-rose-100/80 shadow-[inset_4px_0_0_0_theme(colors.rose.500)] dark:bg-rose-500/15 dark:shadow-[inset_4px_0_0_0_rgba(251,113,133,0.9)]";

export const ADMIN_INACTIVE_MASTER_ROW_CLASS =
  "bg-rose-100/70 shadow-[inset_4px_0_0_0_theme(colors.rose.500)] dark:bg-rose-500/12 dark:shadow-[inset_4px_0_0_0_rgba(251,113,133,0.85)]";

export const ADMIN_CANCELLED_REPORT_ROW_CLASS =
  "bg-rose-50/90 line-through decoration-2 decoration-rose-400 dark:bg-rose-500/10 dark:decoration-rose-300/80";

export function getAdminDocumentRowClass(isCancelled: boolean) {
  return isCancelled ? ADMIN_CANCELLED_ROW_CLASS : ADMIN_ACTIVE_ROW_CLASS;
}

export function getAdminMasterRowClass(isActive: boolean) {
  return isActive ? ADMIN_ACTIVE_ROW_CLASS : ADMIN_INACTIVE_MASTER_ROW_CLASS;
}

export function getAdminReportRowClass(isCancelled: boolean, activeClass = "hover:bg-gray-50 dark:hover:bg-white/5") {
  return cn(activeClass, isCancelled ? ADMIN_CANCELLED_REPORT_ROW_CLASS : null);
}

export function getAdminActiveBadgeTone(isActive: boolean): "success" | "danger" {
  return isActive ? "success" : "danger";
}
