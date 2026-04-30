const Loading = () => (
  <div className="-m-4 animate-pulse lg:-m-6">
    <div className="border-b border-gray-200 px-4 py-3 dark:border-white/10">
      <div className="flex items-center justify-between">
        <div>
          <div className="h-6 w-28 rounded-lg bg-gray-200 dark:bg-slate-800" />
          <div className="mt-2 h-3 w-16 rounded-md bg-gray-200 dark:bg-slate-800" />
        </div>
        <div className="h-10 w-32 rounded-full bg-gray-200 dark:bg-slate-800" />
      </div>
      <div className="mt-3 flex gap-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-9 w-24 rounded-full border border-gray-100 bg-white dark:border-white/10 dark:bg-slate-900"
          />
        ))}
      </div>
    </div>
    <div className="space-y-3 px-3 py-3 sm:px-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-3xl border border-gray-100 bg-white dark:border-white/10 dark:bg-slate-900"
        >
          <div className="flex items-stretch border-b border-gray-100 dark:border-white/10">
            <div className="h-14 w-14 bg-gray-200 dark:bg-slate-800" />
            <div className="flex-1 px-4 py-3">
              <div className="h-4 w-28 rounded-md bg-gray-200 dark:bg-slate-800" />
              <div className="mt-2 h-3 w-20 rounded-md bg-gray-200 dark:bg-slate-800" />
            </div>
          </div>
          <div className="space-y-3 px-4 py-3">
            <div className="h-4 w-40 rounded-md bg-gray-200 dark:bg-slate-800" />
            <div className="grid grid-cols-2 gap-2">
              <div className="h-10 rounded-xl bg-gray-100 dark:bg-slate-800/60" />
              <div className="h-10 rounded-xl bg-gray-100 dark:bg-slate-800/60" />
            </div>
          </div>
          <div className="border-t border-gray-100 px-4 py-3 dark:border-white/10">
            <div className="h-11 w-full rounded-xl bg-gray-200 dark:bg-slate-800" />
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default Loading;
