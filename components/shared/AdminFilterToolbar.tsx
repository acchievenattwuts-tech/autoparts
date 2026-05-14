import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type AdminFilterToolbarProps = {
  children: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

const AdminFilterToolbar = ({
  children,
  summary,
  actions,
  className,
}: AdminFilterToolbarProps) => (
  <div
    className={cn(
      "mb-4 rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-slate-950/80 sm:p-4",
      className,
    )}
  >
    <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
      <div className="min-w-0 flex-1">{children}</div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
    {summary ? (
      <div className="mt-3 border-t border-gray-100 pt-3 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
        {summary}
      </div>
    ) : null}
  </div>
);

export default AdminFilterToolbar;
