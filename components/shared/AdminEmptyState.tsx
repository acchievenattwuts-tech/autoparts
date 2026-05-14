import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

import { cn } from "@/lib/utils";

type AdminEmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

const AdminEmptyState = ({
  title,
  description,
  icon,
  actions,
  className,
}: AdminEmptyStateProps) => (
  <div
    className={cn(
      "flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center dark:border-white/10 dark:bg-white/5",
      className,
    )}
  >
    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm dark:bg-slate-900 dark:text-slate-500">
      {icon ?? <Inbox size={20} />}
    </div>
    <p className="font-kanit text-base font-semibold text-slate-900 dark:text-slate-100">{title}</p>
    {description ? (
      <p className="mt-1 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
    ) : null}
    {actions ? <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div> : null}
  </div>
);

export default AdminEmptyState;
