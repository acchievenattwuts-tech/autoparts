import BrandLoader from "@/components/shared/BrandLoader";

const Loading = () => (
  <div className="min-h-screen bg-gray-50">
    <BrandLoader variant="overlay" size="lg" label="กำลังโหลด..." />
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Result count bar */}
      <div className="mb-6 flex items-center justify-between">
        <div className="h-5 w-40 bg-gray-200 rounded animate-pulse" />
        <div className="h-5 w-32 bg-gray-200 rounded animate-pulse" />
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Filter sidebar */}
        <aside className="w-full shrink-0 lg:w-72">
          <div className="rounded-2xl border border-gray-100 bg-white p-5">
            <div className="h-6 w-36 bg-gray-200 rounded mb-2 animate-pulse" />
            <div className="h-4 w-48 bg-gray-200 rounded mb-5 animate-pulse" />
            <div className="h-5 w-28 bg-gray-200 rounded mb-4 animate-pulse" />
            <div className="space-y-3">
              {[...Array(7)].map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-4 w-4 bg-gray-200 rounded animate-pulse" />
                  <div className="h-4 w-40 bg-gray-200 rounded animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Product grid */}
        <div className="min-w-0 flex-1">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(9)].map((_, i) => (
              <div
                key={i}
                className="overflow-hidden rounded-2xl border border-gray-100 bg-white animate-pulse"
              >
                <div className="h-44 bg-gray-200" />
                <div className="space-y-2 p-4">
                  <div className="h-4 w-20 bg-gray-200 rounded-full" />
                  <div className="h-4 w-full bg-gray-200 rounded" />
                  <div className="h-4 w-3/4 bg-gray-200 rounded" />
                  <div className="mt-3 h-8 bg-gray-200 rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default Loading;
