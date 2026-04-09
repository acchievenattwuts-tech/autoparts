const ReportsPrintLoading = () => (
  <div className="mx-auto max-w-7xl space-y-6 bg-white p-4">
    <div className="flex items-start justify-between">
      <div className="space-y-2">
        <div className="h-8 w-72 animate-pulse rounded bg-gray-200" />
        <div className="h-4 w-56 animate-pulse rounded bg-gray-100" />
      </div>
      <div className="h-10 w-28 animate-pulse rounded-lg bg-gray-100" />
    </div>

    <div className="grid gap-4 md:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-28 animate-pulse rounded-xl bg-gray-100" />
      ))}
    </div>

    <div className="h-[520px] w-full animate-pulse rounded-xl bg-gray-50" />
  </div>
);

export default ReportsPrintLoading;
