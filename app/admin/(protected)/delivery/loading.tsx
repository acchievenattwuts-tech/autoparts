const Loading = () => (
  <div className="animate-pulse space-y-4">
    <div className="flex items-center justify-between">
      <div className="h-8 w-40 rounded-lg bg-gray-200 dark:bg-slate-800" />
      <div className="h-8 w-28 rounded-lg bg-gray-200 dark:bg-slate-800" />
    </div>
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="h-9 w-32 rounded-full border border-gray-100 bg-white dark:border-white/10 dark:bg-slate-900"
        />
      ))}
    </div>
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white dark:border-white/10 dark:bg-slate-900">
      <div className="h-12 border-b border-gray-100 bg-gray-50 dark:border-white/10 dark:bg-slate-800/70" />
      <div className="space-y-3 p-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-14 rounded-lg bg-gray-100 dark:bg-slate-800" />
        ))}
      </div>
    </div>
  </div>
);

export default Loading;
