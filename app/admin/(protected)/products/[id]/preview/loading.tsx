export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-48 rounded-lg bg-gray-200 dark:bg-white/10" />
      <div className="rounded-xl border border-gray-100 bg-white p-6 dark:border-white/10 dark:bg-slate-900">
        <div className="flex gap-6">
          <div className="h-40 w-40 flex-shrink-0 rounded-xl bg-gray-200 dark:bg-white/10" />
          <div className="flex-1 space-y-3">
            <div className="h-4 w-24 rounded bg-gray-200 dark:bg-white/10" />
            <div className="h-6 w-2/3 rounded bg-gray-200 dark:bg-white/10" />
            <div className="h-4 w-1/2 rounded bg-gray-200 dark:bg-white/10" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-slate-900">
            <div className="h-3 w-16 rounded bg-gray-200 dark:bg-white/10" />
            <div className="mt-2 h-5 w-20 rounded bg-gray-200 dark:bg-white/10" />
          </div>
        ))}
      </div>
    </div>
  );
}
