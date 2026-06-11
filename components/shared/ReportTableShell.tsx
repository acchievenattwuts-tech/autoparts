import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ReportTableShellProps = {
  children: ReactNode;
  className?: string;
  tableClassName?: string;
};

const ReportTableShell = ({
  children,
  className,
  tableClassName,
}: ReportTableShellProps) => {
  return (
    <div
      className={cn(
        "-mx-4 overflow-x-auto border-y border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950 dark:[&_tbody]:!divide-white/10 dark:[&_td]:!text-slate-200 dark:[&_tfoot]:!border-white/10 dark:[&_tfoot]:!bg-slate-900 dark:[&_th]:!border-white/10 dark:[&_tr:hover]:!bg-white/5 sm:mx-0 sm:rounded-lg sm:border",
        className,
      )}
    >
      <table className={cn("min-w-[1120px] w-full text-sm", tableClassName)}>
        {children}
      </table>
    </div>
  );
};

export default ReportTableShell;
