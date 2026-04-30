const Loading = () => (
  <div className="animate-pulse space-y-4">
    <div className="flex items-center justify-between">
      <div className="h-7 w-44 rounded-lg bg-gray-200 dark:bg-slate-800" />
      <div className="h-6 w-20 rounded-lg bg-gray-200 dark:bg-slate-800" />
    </div>
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="h-10 w-28 rounded-full border border-gray-100 bg-white dark:border-white/10 dark:bg-slate-900"
        />
      ))}
    </div>
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="h-48 rounded-xl border border-gray-100 bg-white dark:border-white/10 dark:bg-slate-900"
        />
      ))}
    </div>
  </div>
);

export default Loading;
