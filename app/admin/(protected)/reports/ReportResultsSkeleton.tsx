/**
 * Suspense fallback for the results half of a report page.
 *
 * Report pages stream in two parts: the header + filter form render as soon as
 * the permission check resolves, and the table waits behind this skeleton. It
 * mirrors the summary line + table shell so the real table drops into the same
 * box instead of pushing the filters around when it arrives.
 */

const barClass = "rounded bg-gray-200 dark:bg-white/10";

const ReportResultsSkeleton = ({ rows = 10 }: { rows?: number }) => (
  <div
    className="space-y-4"
    aria-busy="true"
    aria-label="กำลังโหลดข้อมูลรายงาน"
  >
    <div className="flex items-center justify-between">
      <div className={`h-4 w-40 animate-pulse ${barClass}`} />
      <div className={`h-8 w-32 animate-pulse ${barClass}`} />
    </div>

    <div className="-mx-4 overflow-hidden border-y border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950 sm:mx-0 sm:rounded-lg sm:border">
      <div className="h-10 animate-pulse bg-[#1e3a5f]/80 dark:bg-[#1e3a5f]" />
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-9 animate-pulse border-t border-gray-100 bg-gray-50/60 dark:border-white/5 dark:bg-white/[0.02]"
        />
      ))}
    </div>
  </div>
);

export default ReportResultsSkeleton;
