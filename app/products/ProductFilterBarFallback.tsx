const skeletonRow = "h-4 rounded-full bg-slate-200/80";

const ProductFilterBarFallback = () => (
  <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_14px_40px_-24px_rgba(15,23,42,0.28)]">
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
      <div className="flex items-center gap-3">
        <span className="rounded-2xl bg-[#1e3a5f]/8 p-2.5">
          <span className="block h-4 w-4 rounded bg-[#1e3a5f]/20" />
        </span>
        <div className="space-y-2">
          <div className="h-4 w-28 rounded-full bg-slate-200/80" />
          <div className="h-3 w-40 rounded-full bg-slate-100" />
        </div>
      </div>
      <span className="block h-4 w-4 rounded-full bg-slate-200/80" />
    </div>

    <div className="space-y-6 px-5 py-5">
      <section className="space-y-3">
        <div className="space-y-2">
          <div className="h-3 w-14 rounded-full bg-slate-100" />
          <div className="h-5 w-36 rounded-full bg-slate-200/80" />
        </div>

        <div className="space-y-2">
          <div className={`${skeletonRow} w-28`} />
          <div className={`${skeletonRow} w-24`} />
          <div className={`${skeletonRow} w-32`} />
          <div className={`${skeletonRow} w-20`} />
        </div>
      </section>

      <section className="space-y-3 border-t border-slate-200 pt-5">
        <div className="space-y-2">
          <div className="h-3 w-24 rounded-full bg-slate-100" />
          <div className="h-5 w-40 rounded-full bg-slate-200/80" />
        </div>

        <div className="space-y-2">
          <div className={`${skeletonRow} w-20`} />
          <div className={`${skeletonRow} w-40`} />
          <div className={`${skeletonRow} w-28`} />
          <div className={`${skeletonRow} w-24`} />
        </div>
      </section>
    </div>
  </div>
);

export default ProductFilterBarFallback;
