const Loading = () => (
  <div className="space-y-4 animate-pulse">
    <div className="h-6 w-40 bg-gray-200 rounded" />
    <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-3">
      <div className="h-5 w-32 bg-gray-200 rounded" />
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 bg-gray-100 rounded" />
        ))}
      </div>
    </div>
    <div className="bg-white rounded-xl border border-gray-100 p-6">
      <div className="h-4 w-24 bg-gray-200 rounded mb-4" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-8 bg-gray-100 rounded mb-2" />
      ))}
    </div>
  </div>
);

export default Loading;
