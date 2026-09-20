export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="กำลังโหลดรายงานกำไรขั้นต้น">
      <div className="h-20 animate-pulse rounded-xl bg-slate-200 dark:bg-white/10" />
      <div className="h-64 animate-pulse rounded-xl bg-slate-200 dark:bg-white/10" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-xl bg-slate-200 dark:bg-white/10" />
        ))}
      </div>
      <div className="h-96 animate-pulse rounded-xl bg-slate-200 dark:bg-white/10" />
    </div>
  );
}
