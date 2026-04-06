export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-9 w-36 rounded-md bg-gray-200" />
        ))}
      </div>
      <div className="h-4 w-32 rounded bg-gray-200" />
      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <div className="h-10 bg-gray-300" />
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-9 border-t border-gray-100 bg-gray-50" />
        ))}
      </div>
    </div>
  );
}
