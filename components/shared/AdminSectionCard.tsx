import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type AdminSectionCardProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
};

const AdminSectionCard = ({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: AdminSectionCardProps) => (
  <section
    className={cn(
      "overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/80",
      className,
    )}
  >
    {(title || description || actions) && (
      <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/10 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="min-w-0">
          {title ? (
            <h2 className="font-kanit text-base font-semibold text-slate-950 dark:text-slate-50">
              {title}
            </h2>
          ) : null}
          {description ? (
            <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    )}
    <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
  </section>
);

export default AdminSectionCard;
