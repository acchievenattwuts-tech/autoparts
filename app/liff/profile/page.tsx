import { CalendarCheck } from "lucide-react";

import LiffBottomNav from "@/components/liff/LiffBottomNav";
import LiffLinkRequired from "@/components/liff/LiffLinkRequired";
import { getLiffCustomer } from "@/lib/liff-data";
import { formatDateThai } from "@/lib/th-date";

export default async function LiffProfilePage() {
  const customer = await getLiffCustomer();
  if (!customer) {
    return (
      <LiffLinkRequired
        title="ผูกเบอร์เพื่อดูข้อมูลส่วนตัว"
        description="กรุณาผูกบัญชี LINE กับเบอร์โทรที่ลงทะเบียนไว้กับร้าน เพื่อดูข้อมูลลูกค้าของคุณ"
      />
    );
  }
  const missing = [
    !customer.shippingAddress ? "ที่อยู่จัดส่ง" : null,
    !customer.taxId ? "เลขผู้เสียภาษี" : null,
  ].filter(Boolean);

  return (
    <main className="min-h-dvh bg-gradient-to-b from-white via-sky-50 to-white pb-24 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <section className="overflow-hidden rounded-b-[28px] border-b border-blue-100 bg-gradient-to-br from-white via-sky-50 to-blue-100 px-5 pb-6 pt-6 text-[#083a78] shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 dark:text-sky-200">
        <p className="text-sm font-semibold text-blue-700 dark:text-sky-400">ข้อมูลลูกค้า</p>
        <h1 className="mt-1 font-kanit text-2xl font-bold dark:text-slate-100">{customer.name}</h1>
      </section>

      <section className="space-y-4 px-5 py-5">
        {missing.length > 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 shadow-sm dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            ติดต่อพนักงานเพื่อแก้ไขข้อมูลส่วนตัว
          </div>
        ) : null}

        <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="font-kanit text-lg font-bold text-slate-950 dark:text-slate-100">ข้อมูลติดต่อ</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-slate-500 dark:text-slate-400">รหัสลูกค้า</dt>
              <dd className="font-mono font-semibold text-slate-950 dark:text-slate-100">{customer.code ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">เบอร์โทร</dt>
              <dd className="font-semibold text-slate-950 dark:text-slate-100">{customer.phone ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">ที่อยู่</dt>
              <dd className="font-semibold text-slate-950 dark:text-slate-100">{customer.address ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">ที่อยู่จัดส่ง</dt>
              <dd className="font-semibold text-slate-950 dark:text-slate-100">{customer.shippingAddress ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">เลขผู้เสียภาษี</dt>
              <dd className="font-semibold text-slate-950 dark:text-slate-100">{customer.taxId ?? "-"}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex gap-3">
            <CalendarCheck className="mt-0.5 h-5 w-5 text-blue-700 dark:text-sky-400" />
            <div>
              <p className="font-semibold text-slate-950 dark:text-slate-100">ผูก LINE แล้ว</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {customer.lineLinkedAt ? formatDateThai(customer.lineLinkedAt) : "พร้อมใช้งาน"}
              </p>
            </div>
          </div>
        </div>
      </section>
      <LiffBottomNav active="/liff/profile" />
    </main>
  );
}
