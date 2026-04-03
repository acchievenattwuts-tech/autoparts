const Loading = () => (
  <main className="min-h-screen bg-slate-50 pt-16">
    <section className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
      </div>
    </section>

    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(340px,0.85fr)]">
        <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <div className="aspect-[4/3] animate-pulse bg-slate-200" />
        </div>

        <div className="space-y-6">
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex gap-3">
              <div className="h-6 w-24 animate-pulse rounded-full bg-slate-200" />
              <div className="h-6 w-20 animate-pulse rounded-full bg-slate-200" />
            </div>
            <div className="mt-4 h-10 w-4/5 animate-pulse rounded bg-slate-200" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="h-20 animate-pulse rounded-2xl bg-slate-100" />
              <div className="h-20 animate-pulse rounded-2xl bg-slate-100" />
            </div>
            <div className="mt-5 h-28 animate-pulse rounded-3xl bg-slate-100" />
            <div className="mt-6 flex gap-3">
              <div className="h-12 w-40 animate-pulse rounded-full bg-slate-200" />
              <div className="h-12 w-32 animate-pulse rounded-full bg-slate-200" />
            </div>
          </div>
        </div>
      </div>
    </section>
  </main>
);

export default Loading;
