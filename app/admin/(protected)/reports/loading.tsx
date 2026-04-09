const ReportsLoading = () => (
  <div className="space-y-0">
    <div className="mb-4 flex items-center gap-3">
      <div className="h-6 w-6 animate-pulse rounded bg-gray-200" />
      <div className="space-y-2">
        <div className="h-7 w-40 animate-pulse rounded bg-gray-200" />
        <div className="h-4 w-72 animate-pulse rounded bg-gray-100" />
      </div>
    </div>

    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-4 pt-4">
        <div className="flex flex-wrap gap-2 pb-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-9 w-24 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      </div>
      <div className="space-y-4 p-4">
        <div className="h-12 w-full animate-pulse rounded-xl bg-gray-100" />
        <div className="h-64 w-full animate-pulse rounded-xl bg-gray-50" />
      </div>
    </div>
  </div>
);

export default ReportsLoading;
