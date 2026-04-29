const Loading = () => (
  <div className="animate-pulse space-y-4">
    <div className="h-8 w-56 rounded-lg bg-gray-200 dark:bg-slate-800" />
    <div className="grid gap-3 md:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="h-24 rounded-xl border border-gray-100 bg-white dark:border-white/10 dark:bg-slate-900"
        />
      ))}
    </div>
    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <div className="rounded-2xl border border-gray-100 bg-white p-5 dark:border-white/10 dark:bg-slate-900">
        <div className="space-y-3">
          <div className="h-5 w-40 rounded bg-gray-100 dark:bg-slate-800" />
          <div className="h-40 rounded-2xl bg-gray-100 dark:bg-slate-800" />
          <div className="grid gap-3 md:grid-cols-2">
            <div className="h-24 rounded-2xl bg-gray-100 dark:bg-slate-800" />
            <div className="h-24 rounded-2xl bg-gray-100 dark:bg-slate-800" />
          </div>
        </div>
      </div>
      <div className="rounded-2xl border border-gray-100 bg-white p-5 dark:border-white/10 dark:bg-slate-900">
        <div className="space-y-3">
          <div className="h-5 w-32 rounded bg-gray-100 dark:bg-slate-800" />
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-12 rounded-xl bg-gray-100 dark:bg-slate-800" />
          ))}
        </div>
      </div>
    </div>
  </div>
);

export default Loading;
