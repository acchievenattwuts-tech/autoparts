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
  neutral: "border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200",
  warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200",
  danger: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200",
  info: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-200",
  pending: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/20 dark:bg-violet-400/10 dark:text-violet-200",
  muted: "border-gray-200 bg-gray-100 text-gray-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400",
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
