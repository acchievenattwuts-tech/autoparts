import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type AdminStatusBadgeTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "pending"
  | "muted";

type AdminStatusBadgeProps = {
  children: ReactNode;
  tone?: AdminStatusBadgeTone;
  className?: string;
};

const toneClass: Record<AdminStatusBadgeTone, string> = {
  neutral: "border-slate-300 bg-slate-100 text-slate-800 dark:border-slate-400/70 dark:bg-slate-600/40 dark:text-slate-100",
  success: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-400/60 dark:bg-emerald-500/25 dark:text-emerald-200",
  warning: "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-400/60 dark:bg-amber-500/25 dark:text-amber-200",
  danger: "border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-400/60 dark:bg-rose-500/25 dark:text-rose-200",
  info: "border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-400/60 dark:bg-sky-500/25 dark:text-sky-200",
  pending: "border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-400/60 dark:bg-violet-500/25 dark:text-violet-200",
  muted: "border-gray-300 bg-gray-200 text-gray-700 dark:border-slate-500/70 dark:bg-slate-600/30 dark:text-slate-200",
};

const AdminStatusBadge = ({ children, tone = "neutral", className }: AdminStatusBadgeProps) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5",
      toneClass[tone],
      className,
    )}
  >
    {children}
  </span>
);

export default AdminStatusBadge;
