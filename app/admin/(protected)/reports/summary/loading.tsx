export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <div className="h-3 w-16 animate-pulse rounded bg-gray-200" />
          <div className="h-9 w-40 animate-pulse rounded-md bg-gray-100" />
        </div>
        <div className="flex flex-col gap-1">
          <div className="h-3 w-12 animate-pulse rounded bg-gray-200" />
          <div className="h-9 w-40 animate-pulse rounded-md bg-gray-100" />
        </div>
        <div className="h-9 w-28 animate-pulse rounded-md bg-gray-200" />
        <div className="h-9 w-20 animate-pulse rounded-md bg-gray-100" />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-gray-100" />
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-2xl bg-gray-100" />
        ))}
      </div>

      <div className="h-[720px] animate-pulse rounded-2xl bg-gray-100" />
    </div>
  );
}
