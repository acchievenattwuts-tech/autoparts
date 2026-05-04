import LinkPhoneForm from "@/components/liff/LinkPhoneForm";

export default function LiffLinkPage() {
  return (
    <main className="min-h-dvh px-5 py-6">
      <div className="mb-6 rounded-lg bg-slate-950 px-5 py-6 text-white">
        <p className="font-kanit text-2xl font-bold">ศรีวรรณ อะไหล่แอร์</p>
        <p className="mt-2 text-sm leading-6 text-slate-200">
          ผูกบัญชี LINE กับข้อมูลลูกค้า เพื่อดูบิล ประวัติซื้อ และข้อมูลบริการของคุณ
        </p>
      </div>
      <LinkPhoneForm />
    </main>
  );
}
