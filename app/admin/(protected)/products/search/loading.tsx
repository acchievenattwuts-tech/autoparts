const barClass = "rounded bg-gray-200 dark:bg-white/10";

/** Mirrors the product result card (image column + text column) to avoid layout shift. */
const ProductCardSkeleton = () => (
  <div className="animate-pulse rounded-[24px] border border-gray-200 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-slate-900">
    <div className="flex gap-3">
      <div className="flex w-28 shrink-0 flex-col gap-2 sm:w-32">
        <div className={`aspect-square w-full rounded-2xl ${barClass}`} />
        <div className={`h-8 w-full ${barClass}`} />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className={`h-3 w-20 ${barClass}`} />
        <div className={`h-4 w-full ${barClass}`} />
        <div className={`h-4 w-3/4 ${barClass}`} />
        <div className={`h-3 w-1/2 ${barClass}`} />
        <div className={`mt-4 h-6 w-24 ${barClass}`} />
      </div>
    </div>
  </div>
);

export default function ProductSearchLoading() {
  return (
    <div
      className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900"
      aria-busy="true"
      aria-label="กำลังโหลดผลการค้นหาสินค้า"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-8 sm:px-6 lg:py-4">
        <div className={`h-11 w-full animate-pulse rounded-xl ${barClass}`} />

        <div className="flex gap-2 overflow-hidden pb-1" aria-hidden="true">
          {["w-24", "w-20", "w-28", "w-24"].map((width) => (
            <div
              key={width}
              className={`h-8 shrink-0 animate-pulse rounded-full ${width} ${barClass}`}
            />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <ProductCardSkeleton key={index} />
          ))}
        </div>
      </div>
    </div>
  );
}
