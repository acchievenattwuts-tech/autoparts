const Loading = () => (
  <div className="min-h-screen bg-gray-50 pt-16">
    <div className="bg-[#1e3a5f] py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="h-8 w-48 bg-white/20 rounded-lg mb-5 animate-pulse" />
        <div className="h-10 w-full max-w-xl bg-white/20 rounded-xl animate-pulse" />
      </div>
    </div>
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex gap-2 flex-wrap mb-6">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-8 w-24 bg-gray-200 rounded-full animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border border-gray-100 overflow-hidden animate-pulse">
            <div className="h-44 bg-gray-200" />
            <div className="p-4 space-y-2">
              <div className="h-4 w-20 bg-gray-200 rounded-full" />
              <div className="h-4 w-full bg-gray-200 rounded" />
              <div className="h-4 w-3/4 bg-gray-200 rounded" />
              <div className="h-8 bg-gray-200 rounded-lg mt-3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default Loading;
