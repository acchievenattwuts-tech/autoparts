import { LoaderCircle } from "lucide-react";

const skeletons = ["w-40", "w-56", "w-32", "w-48"];

export default function KnowledgeLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="กำลังโหลดคลังความรู้">
      <div className="flex min-h-28 items-center justify-center rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/80">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600 dark:text-slate-300">
          <LoaderCircle className="h-5 w-5 animate-spin text-orange-500" />
          กำลังโหลดคลังความรู้...
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {skeletons.map((width, index) => (
          <div key={index} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950/80">
            <div className={`h-3 rounded bg-slate-200 dark:bg-white/10 ${width}`} />
            <div className="mt-4 h-6 w-20 rounded bg-slate-200 dark:bg-white/10" />
          </div>
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/80" />
    </div>
  );
}
