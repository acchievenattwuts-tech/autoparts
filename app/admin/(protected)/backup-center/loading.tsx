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

      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className={`h-40 animate-pulse p-4 ${cardClass}`}>
            <div className={`h-4 w-40 ${barClass}`} />
            <div className={`mt-4 h-3 w-full ${barClass}`} />
            <div className={`mt-2 h-3 w-2/3 ${barClass}`} />
            <div className={`mt-6 h-9 w-32 ${barClass}`} />
          </div>
        ))}
      </div>

      <div className={`animate-pulse overflow-hidden ${cardClass}`}>
        <div className="h-11 border-b border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/5" />
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="h-12 border-t border-slate-100 first:border-t-0 dark:border-white/5"
          />
        ))}
      </div>
    </div>
  );
}
