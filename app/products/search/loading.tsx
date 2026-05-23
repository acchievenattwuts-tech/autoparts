const Loading = () => (
  <div className="min-h-screen bg-gray-50 pt-16">
    <div className="bg-[#1e3a5f] py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="h-8 w-48 bg-white/20 rounded-lg mb-5 animate-pulse" />
        <div className="h-10 w-full max-w-xl bg-white/20 rounded-xl animate-pulse" />
      </div>
    </div>
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="w-full shrink-0 lg:w-72">
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-10 w-full bg-gray-200 rounded-xl animate-pulse" />
            ))}
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            {[...Array(9)].map((_, i) => (
              <div
                key={i}
                className="bg-white rounded-2xl border border-gray-100 overflow-hidden animate-pulse"
              >
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
          <div className="mt-8 h-14 bg-white border border-gray-200 rounded-3xl animate-pulse" />
        </div>
      </div>
    </div>
  </div>
);

export default Loading;
