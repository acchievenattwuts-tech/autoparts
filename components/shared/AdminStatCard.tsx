import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type AdminStatCardProps = {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  accent?: "default" | "success" | "warning" | "danger" | "info";
  className?: string;
};

const accentClass = {
  default: "text-[#1e3a5f] dark:text-sky-200",
  success: "text-emerald-700 dark:text-emerald-300",
  warning: "text-amber-700 dark:text-amber-300",
  danger: "text-rose-700 dark:text-rose-300",
  info: "text-sky-700 dark:text-sky-300",
} as const;

const AdminStatCard = ({
  label,
  value,
  hint,
  icon,
  accent = "default",
  className,
}: AdminStatCardProps) => (
  <div
    className={cn(
      "rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/80",
      className,
    )}
  >
    <div className="flex items-start justify-between gap-3">
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      {icon ? <div className="shrink-0 text-slate-400 dark:text-slate-500">{icon}</div> : null}
    </div>
    <p className={cn("mt-2 font-kanit text-2xl font-semibold leading-none", accentClass[accent])}>
      {value}
    </p>
    {hint ? <p className="mt-2 text-xs leading-5 text-slate-400 dark:text-slate-500">{hint}</p> : null}
  </div>
);

export default AdminStatCard;
