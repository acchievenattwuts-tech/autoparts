import BrandLoader from "@/components/shared/BrandLoader";

export default function LiffPageLoading({
  title = "กำลังโหลดข้อมูล",
  subtitle = "ระบบกำลังเตรียมข้อมูลล่าสุดให้คุณ",
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <main className="min-h-dvh bg-gradient-to-b from-white via-sky-50 to-white pb-24 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <section className="overflow-hidden rounded-b-[28px] border-b border-blue-100 bg-gradient-to-br from-white via-sky-50 to-blue-100 px-5 pb-6 pt-6 text-[#083a78] shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 dark:text-sky-200">
        <div className="h-3 w-24 rounded-full bg-blue-100 dark:bg-slate-700" />
        <div className="mt-3 h-8 w-48 rounded-full bg-blue-100/80 dark:bg-slate-700/80" />
        <div className="mt-5 rounded-2xl border border-blue-100 bg-white/85 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/85">
          <div className="mb-3 w-fit">
            <BrandLoader variant="inline" size="md" />
          </div>
          <p className="font-kanit text-lg font-bold dark:text-slate-100">{title}</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{subtitle}</p>
        </div>
      </section>

      <section className="space-y-3 px-5 py-5">
        <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="h-4 w-32 rounded-full bg-blue-50 dark:bg-slate-700" />
          <div className="mt-4 h-16 rounded-xl bg-blue-50 dark:bg-slate-700" />
        </div>
        <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="h-4 w-40 rounded-full bg-blue-50 dark:bg-slate-700" />
          <div className="mt-4 space-y-2">
            <div className="h-3 rounded-full bg-blue-50 dark:bg-slate-700" />
            <div className="h-3 w-2/3 rounded-full bg-blue-50 dark:bg-slate-700" />
          </div>
        </div>
      </section>
    </main>
  );
}
