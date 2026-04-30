const Loading = () => (
  <div className="space-y-6 animate-pulse">
    <div>
      <div className="mb-4 h-4 w-28 rounded bg-gray-200 dark:bg-slate-800" />
      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900">
        <div className="h-4 w-24 rounded bg-gray-200 dark:bg-slate-800" />
        <div className="mt-3 h-7 w-56 rounded bg-gray-200 dark:bg-slate-800" />
        <div className="mt-2 h-4 w-36 rounded bg-gray-100 dark:bg-slate-800/70" />
      </div>
    </div>

    {Array.from({ length: 3 }).map((_, index) => (
      <div
        key={index}
        className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900"
      >
        <div className="h-4 w-40 rounded bg-gray-200 dark:bg-slate-800" />
        <div className="mt-2 h-3 w-56 rounded bg-gray-100 dark:bg-slate-800/70" />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="h-36 rounded-xl bg-gray-100 dark:bg-slate-800/70" />
          <div className="h-36 rounded-xl bg-gray-100 dark:bg-slate-800/70" />
        </div>
      </div>
    ))}
  </div>
);

export default Loading;
