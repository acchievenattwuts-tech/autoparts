import { LoaderCircle } from "lucide-react";

export default function LiffPageLoading({
  title = "กำลังโหลดข้อมูล",
  subtitle = "ระบบกำลังเตรียมข้อมูลล่าสุดให้คุณ",
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <main className="min-h-dvh bg-gradient-to-b from-white via-sky-50 to-white pb-24">
      <section className="overflow-hidden rounded-b-[28px] border-b border-blue-100 bg-gradient-to-br from-white via-sky-50 to-blue-100 px-5 pb-6 pt-6 text-[#083a78] shadow-sm">
        <div className="h-3 w-24 rounded-full bg-blue-100" />
        <div className="mt-3 h-8 w-48 rounded-full bg-blue-100/80" />
        <div className="mt-5 rounded-2xl border border-blue-100 bg-white/85 p-4 shadow-sm">
          <LoaderCircle className="mb-3 h-6 w-6 animate-spin text-blue-700" />
          <p className="font-kanit text-lg font-bold">{title}</p>
          <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
        </div>
      </section>

      <section className="space-y-3 px-5 py-5">
        <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <div className="h-4 w-32 rounded-full bg-blue-50" />
          <div className="mt-4 h-16 rounded-xl bg-blue-50" />
        </div>
        <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <div className="h-4 w-40 rounded-full bg-blue-50" />
          <div className="mt-4 space-y-2">
            <div className="h-3 rounded-full bg-blue-50" />
            <div className="h-3 w-2/3 rounded-full bg-blue-50" />
          </div>
        </div>
      </section>
    </main>
  );
}
