import { ShieldAlert } from "lucide-react";

import LinkPhoneForm from "@/components/liff/LinkPhoneForm";

type LiffLinkRequiredProps = {
  title?: string;
  description?: string;
};

export default function LiffLinkRequired({
  title = "กรุณาผูกเบอร์โทรก่อนใช้งาน",
  description = "ผูกบัญชี LINE กับเบอร์โทรที่ลงทะเบียนไว้กับร้าน เพื่อดูข้อมูลของคุณ",
}: LiffLinkRequiredProps) {
  return (
    <main className="min-h-dvh bg-gradient-to-b from-white via-sky-50 to-white px-5 py-6 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="mb-5 overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-amber-50 px-5 py-5 shadow-sm dark:border-amber-800 dark:from-amber-950 dark:via-slate-900 dark:to-amber-950">
        <div className="flex gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
            <ShieldAlert size={20} />
          </div>
          <div>
            <p className="font-kanit text-lg font-bold text-amber-900 dark:text-amber-200">{title}</p>
            <p className="mt-1 text-sm leading-6 text-amber-800/90 dark:text-amber-300/90">{description}</p>
          </div>
        </div>
      </div>
      <LinkPhoneForm />
    </main>
  );
}
