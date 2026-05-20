import LinkPhoneForm from "@/components/liff/LinkPhoneForm";

export default function LiffLinkPage() {
  return (
    <main className="min-h-dvh bg-gradient-to-b from-white via-sky-50 to-white px-5 py-6 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="mb-6 overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-white via-sky-50 to-blue-100 px-5 py-6 text-[#083a78] shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 dark:text-sky-200">
        <p className="font-kanit text-2xl font-bold dark:text-slate-100">ศรีวรรณ อะไหล่แอร์</p>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
          ผูกบัญชี LINE กับข้อมูลลูกค้า เพื่อดูบิล ประวัติซื้อ และข้อมูลบริการของคุณ
        </p>
      </div>
      <LinkPhoneForm />
    </main>
  );
}
