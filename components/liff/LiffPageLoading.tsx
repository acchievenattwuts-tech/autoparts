import { LoaderCircle } from "lucide-react";

export default function LiffPageLoading({
  title = "กำลังโหลดข้อมูล",
  subtitle = "ระบบกำลังเตรียมข้อมูลล่าสุดให้คุณ",
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <main className="min-h-dvh bg-[#f8faf7] pb-24">
      <section className="bg-slate-950 px-5 pb-6 pt-6 text-white">
        <div className="h-3 w-24 rounded-full bg-white/15" />
        <div className="mt-3 h-8 w-48 rounded-full bg-white/20" />
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/10 p-4">
          <LoaderCircle className="mb-3 h-6 w-6 animate-spin text-teal-200" />
          <p className="font-kanit text-lg font-bold">{title}</p>
          <p className="mt-1 text-sm text-teal-100">{subtitle}</p>
        </div>
      </section>

      <section className="space-y-3 px-5 py-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="h-4 w-32 rounded-full bg-slate-100" />
          <div className="mt-4 h-16 rounded-xl bg-slate-100" />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="h-4 w-40 rounded-full bg-slate-100" />
          <div className="mt-4 space-y-2">
            <div className="h-3 rounded-full bg-slate-100" />
            <div className="h-3 w-2/3 rounded-full bg-slate-100" />
          </div>
        </div>
      </section>
    </main>
  );
}
