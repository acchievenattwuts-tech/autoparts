export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-9 w-36 rounded-md bg-gray-200" />
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl bg-gray-200" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-gray-200" />
    </div>
  );
}
