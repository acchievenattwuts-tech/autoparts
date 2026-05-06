import LinkPhoneForm from "@/components/liff/LinkPhoneForm";

export default function LiffLinkPage() {
  return (
    <main className="min-h-dvh bg-gradient-to-b from-white via-sky-50 to-white px-5 py-6">
      <div className="mb-6 overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-white via-sky-50 to-blue-100 px-5 py-6 text-[#083a78] shadow-sm">
        <p className="font-kanit text-2xl font-bold">ศรีวรรณ อะไหล่แอร์</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          ผูกบัญชี LINE กับข้อมูลลูกค้า เพื่อดูบิล ประวัติซื้อ และข้อมูลบริการของคุณ
        </p>
      </div>
      <LinkPhoneForm />
    </main>
  );
}
