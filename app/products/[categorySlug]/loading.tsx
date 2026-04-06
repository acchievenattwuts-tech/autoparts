const Loading = () => (
  <div className="min-h-screen bg-slate-50 pt-16">
    <section className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <div className="h-5 w-40 animate-pulse rounded-full bg-slate-200" />
      </div>
    </section>

    <section className="overflow-hidden bg-[#10213d]">
      <div className="bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.18),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_32%)]">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
          <div className="max-w-4xl space-y-4">
            <div className="h-4 w-40 animate-pulse rounded-full bg-white/15" />
            <div className="h-10 w-full max-w-2xl animate-pulse rounded-2xl bg-white/20" />
            <div className="space-y-3">
              <div className="h-4 w-full max-w-3xl animate-pulse rounded-full bg-white/10" />
              <div className="h-4 w-full max-w-2xl animate-pulse rounded-full bg-white/10" />
            </div>
            <div className="h-12 w-44 animate-pulse rounded-full bg-white/12" />
          </div>
        </div>
      </div>
    </section>

    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="mb-6 flex flex-wrap gap-3">
        {[...Array(4)].map((_, index) => (
          <div
            key={index}
            className="h-9 w-24 animate-pulse rounded-full bg-slate-200"
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[...Array(8)].map((_, index) => (
          <div
            key={index}
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="h-36 animate-pulse bg-slate-200 sm:h-40 lg:h-44" />
            <div className="space-y-3 p-3 sm:p-4">
              <div className="h-5 w-20 animate-pulse rounded-full bg-slate-200" />
              <div className="h-4 w-full animate-pulse rounded-full bg-slate-200" />
              <div className="h-4 w-4/5 animate-pulse rounded-full bg-slate-200" />
              <div className="h-4 w-2/5 animate-pulse rounded-full bg-slate-200" />
              <div className="pt-2">
                <div className="h-10 animate-pulse rounded-full bg-slate-200" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  </div>
);

export default Loading;
