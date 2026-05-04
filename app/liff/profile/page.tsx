import { CalendarCheck } from "lucide-react";

import LiffBottomNav from "@/components/liff/LiffBottomNav";
import { requireLiffCustomer } from "@/lib/liff-data";
import { formatDateThai } from "@/lib/th-date";

export default async function LiffProfilePage() {
  const customer = await requireLiffCustomer();
  const missing = [
    !customer.shippingAddress ? "ที่อยู่จัดส่ง" : null,
    !customer.taxId ? "เลขผู้เสียภาษี" : null,
  ].filter(Boolean);

  return (
    <main className="min-h-dvh pb-24">
      <section className="bg-slate-950 px-5 pb-6 pt-6 text-white">
        <p className="text-sm text-teal-100">ข้อมูลลูกค้า</p>
        <h1 className="mt-1 font-kanit text-2xl font-bold">{customer.name}</h1>
      </section>

      <section className="space-y-4 px-5 py-5">
        {missing.length > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            ข้อมูลบางส่วนยังไม่ครบ: {missing.join(", ")} พนักงานร้านสามารถช่วยอัปเดตให้ได้
          </div>
        ) : null}

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="font-kanit text-lg font-bold text-slate-950">ข้อมูลติดต่อ</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-slate-500">รหัสลูกค้า</dt>
              <dd className="font-mono font-semibold text-slate-950">{customer.code ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">เบอร์โทร</dt>
              <dd className="font-semibold text-slate-950">{customer.phone ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">ที่อยู่</dt>
              <dd className="font-semibold text-slate-950">{customer.address ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">ที่อยู่จัดส่ง</dt>
              <dd className="font-semibold text-slate-950">{customer.shippingAddress ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">เลขผู้เสียภาษี</dt>
              <dd className="font-semibold text-slate-950">{customer.taxId ?? "-"}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex gap-3">
            <CalendarCheck className="mt-0.5 h-5 w-5 text-teal-700" />
            <div>
              <p className="font-semibold text-slate-950">ผูก LINE แล้ว</p>
              <p className="mt-1 text-sm text-slate-500">
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
