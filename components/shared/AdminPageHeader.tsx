import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type AdminPageHeaderProps = {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

const AdminPageHeader = ({
  title,
  eyebrow,
  description,
  meta,
  actions,
  className,
}: AdminPageHeaderProps) => (
  <div
    className={cn(
      "mb-5 flex flex-col gap-4 rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm dark:border-white/10 dark:bg-slate-950/80 sm:px-5 lg:flex-row lg:items-start lg:justify-between",
      className,
    )}
  >
    <div className="min-w-0 space-y-1">
      {eyebrow ? (
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="font-kanit text-xl font-semibold leading-tight text-slate-950 dark:text-slate-50 sm:text-2xl">
        {title}
      </h1>
      {description ? (
        <p className="max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
          {description}
        </p>
      ) : null}
      {meta ? <div className="pt-1 text-sm text-slate-500 dark:text-slate-400">{meta}</div> : null}
    </div>
    {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
  </div>
);

export default AdminPageHeader;
