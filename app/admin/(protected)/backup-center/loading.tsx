const cardClass =
  "rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/80";
const barClass = "rounded bg-slate-200 dark:bg-white/10";

export default function BackupCenterLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="กำลังโหลด Backup Center">
      <div className="animate-pulse space-y-2">
        <div className={`h-7 w-56 ${barClass}`} />
        <div className={`h-3 w-full max-w-lg ${barClass}`} />
      </div>

      <div className="animate-pulse rounded-lg border border-sky-200 bg-sky-50 p-4 dark:border-sky-400/30 dark:bg-sky-400/10">
        <div className="flex flex-col justify-between gap-4 lg:flex-row">
          <div className="flex-1 space-y-3">
            <div className={`h-5 w-64 max-w-full ${barClass}`} />
            <div className={`h-3 w-full max-w-2xl ${barClass}`} />
            <div className={`h-3 w-2/3 ${barClass}`} />
          </div>
          <div className="space-y-2 lg:w-64">
            <div className={`h-9 w-full ${barClass}`} />
            <div className={`h-9 w-full ${barClass}`} />
          </div>
        </div>
        <div className={`mt-4 overflow-hidden ${cardClass}`}>
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-10 border-t border-slate-100 first:border-t-0 dark:border-white/5" />
          ))}
        </div>
      </div>
    </div>
  );
}
