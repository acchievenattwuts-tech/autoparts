"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { saveManualShopeeSetup } from "./actions";

type Option = { id: string; label: string };

export default function ManualShopeeSetupForm({
  accounts,
  customers,
  initialAccountId = "",
  initialCustomerId = "",
}: {
  accounts: Option[];
  customers: Option[];
  initialAccountId?: string;
  initialCustomerId?: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [message, setMessage] = useState("");

  return (
    <form
      className="space-y-4 rounded-xl border border-orange-200 bg-orange-50 p-5 dark:border-orange-400/30 dark:bg-orange-500/10"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await saveManualShopeeSetup(formData);
          setMessage(result.error ?? "บันทึกการตั้งค่าแล้ว");
          if (result.success) router.refresh();
        });
      }}
    >
      <div>
        <h2 className="font-kanit text-lg font-semibold text-orange-900 dark:text-orange-100">ตั้งค่า Shopee แบบคีย์เองครั้งแรก</h2>
        <p className="mt-1 text-sm text-orange-800 dark:text-orange-200">บัญชีพักเงินเป็นบัญชีเสมือนสำหรับยอดที่ Shopee ยังไม่โอน ส่วนลูกค้าเริ่มต้นใช้เป็นคู่บัญชีของใบขายทุกออเดอร์</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">บัญชีพักเงิน Shopee
          <select name="settlementCashBankAccountId" required defaultValue={initialAccountId} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-white/20 dark:bg-slate-900">
            <option value="">เลือกบัญชี</option>
            {accounts.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">ลูกค้าเริ่มต้น Shopee
          <select name="defaultCustomerId" required defaultValue={initialCustomerId} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-white/20 dark:bg-slate-900">
            <option value="">เลือกลูกค้า</option>
            {customers.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
      </div>
      {message && <p className="text-sm text-slate-700 dark:text-slate-200">{message}</p>}
      <button disabled={pending} aria-busy={pending} className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-60">{pending ? <><LoaderCircle size={15} className="animate-spin"/>กำลังบันทึก...</> : "บันทึกการตั้งค่า"}</button>
    </form>
  );
}
