const Loading = () => (
  <div className="animate-pulse space-y-4">
    <div className="h-8 w-44 rounded-lg bg-gray-200 dark:bg-slate-800" />
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="h-20 rounded-xl border border-gray-100 bg-white dark:border-white/10 dark:bg-slate-900"
        />
      ))}
    </div>
    <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-slate-900">
      <div className="flex flex-wrap gap-3">
        <div className="h-10 w-60 rounded-lg bg-gray-100 dark:bg-slate-800" />
        <div className="h-10 flex-1 rounded-lg bg-gray-100 dark:bg-slate-800" />
      </div>
    </div>
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white dark:border-white/10 dark:bg-slate-900">
      <div className="h-12 border-b border-gray-100 bg-gray-50 dark:border-white/10 dark:bg-slate-800/70" />
      <div className="space-y-3 p-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-12 rounded-lg bg-gray-100 dark:bg-slate-800" />
        ))}
      </div>
    </div>
  </div>
);

export default Loading;
