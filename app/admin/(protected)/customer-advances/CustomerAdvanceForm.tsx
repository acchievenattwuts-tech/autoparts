"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle } from "lucide-react";
import AdminNumberInput from "@/components/shared/AdminNumberInput";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import PaymentChannelsInput, { type PaymentChannelRow } from "@/components/shared/PaymentChannelsInput";
import { getThailandDateKey } from "@/lib/th-date";
import { createCustomerAdvance, updateCustomerAdvance } from "./actions";

type Customer = { id: string; name: string; code: string | null; phone: string | null };
type Account = { id: string; name: string; code: string; type: "CASH" | "BANK"; bankName: string | null; accountNo: string | null };
type InitialData = { id: string; customerId: string; advanceDate: string; totalAmount: number; cashBankAccountId: string; payments?: PaymentChannelRow[]; note: string };

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/20 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500";
const labelCls = "mb-1.5 block text-sm font-medium text-gray-700 dark:text-slate-300";

export default function CustomerAdvanceForm({ customers, cashBankAccounts, initialData, submitLocked = false }: { customers: Customer[]; cashBankAccounts: Account[]; initialData?: InitialData; submitLocked?: boolean }) {
  const router = useRouter();
  const isEdit = Boolean(initialData);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [customerId, setCustomerId] = useState(initialData?.customerId ?? "");
  const [advanceDate, setAdvanceDate] = useState(initialData?.advanceDate ?? getThailandDateKey());
  const [totalAmount, setTotalAmount] = useState(initialData?.totalAmount ?? 0);
  const [note, setNote] = useState(initialData?.note ?? "");
  const [payments, setPayments] = useState<PaymentChannelRow[]>(initialData?.payments?.length ? initialData.payments : initialData?.cashBankAccountId ? [{ cashBankAccountId: initialData.cashBankAccountId, amount: initialData.totalAmount }] : [{ cashBankAccountId: "", amount: 0 }]);

  const options: SelectOption[] = customers.map((customer) => ({ id: customer.id, label: customer.name, sublabel: [customer.code, customer.phone].filter(Boolean).join(" | ") || undefined }));

  const submit = () => {
    setError(""); setSuccess("");
    if (submitLocked) return;
    if (!customerId) return setError("กรุณาเลือกลูกค้า");
    if (!advanceDate) return setError("กรุณาระบุวันที่");
    if (totalAmount <= 0) return setError("ยอดเงินมัดจำต้องมากกว่า 0");
    const active = payments.filter((row) => row.amount > 0);
    if (!active.length) return setError("กรุณาระบุช่องทางรับเงินอย่างน้อย 1 ช่องทาง");
    if (active.some((row) => !row.cashBankAccountId)) return setError("กรุณาเลือกบัญชีให้ครบทุกช่องทาง");
    const paid = Math.round(active.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;
    if (Math.abs(paid - totalAmount) > 0.005) return setError(`ยอดรวมช่องทางรับเงินต้องเท่ากับยอดมัดจำ (${totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท)`);
    const formData = new FormData();
    formData.set("customerId", customerId); formData.set("advanceDate", advanceDate);
    formData.set("totalAmount", String(totalAmount)); formData.set("note", note);
    formData.set("payments", JSON.stringify(active));
    startTransition(async () => {
      const result = isEdit && initialData ? await updateCustomerAdvance(initialData.id, formData) : await createCustomerAdvance(formData);
      if (result.error) return setError(result.error);
      if (isEdit) router.push(`/admin/customer-advances/${initialData!.id}`);
      else if ("advanceId" in result && result.advanceId) router.push(`/admin/customer-advances/${result.advanceId}`);
      else { setSuccess("บันทึกรับเงินมัดจำสำเร็จ"); router.refresh(); }
    });
  };

  return <div className="space-y-6">
    <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
      <h2 className="mb-4 font-kanit text-lg font-semibold text-gray-800 dark:text-slate-100">ข้อมูลรับเงินมัดจำลูกค้า</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div><label className={labelCls}>ลูกค้า <span className="text-red-500">*</span></label><SearchableSelect options={options} value={customerId} onChange={setCustomerId} placeholder="ค้นหาลูกค้า..." disabled={submitLocked} /></div>
        <div><label className={labelCls}>วันที่รับมัดจำ <span className="text-red-500">*</span></label><input type="date" value={advanceDate} onChange={(event) => setAdvanceDate(event.target.value)} disabled={submitLocked} className={inputCls} /></div>
        <div><label className={labelCls}>ยอดเงินมัดจำ <span className="text-red-500">*</span></label><AdminNumberInput min={0} step={0.01} value={totalAmount} onValueChange={setTotalAmount} disabled={submitLocked} className={inputCls} /></div>
        <div className={`md:col-span-2 ${submitLocked ? "pointer-events-none opacity-60" : ""}`}><PaymentChannelsInput accounts={cashBankAccounts} value={payments} onChange={setPayments} targetAmount={totalAmount} label="ช่องทางรับเงิน" placeholder="โปรดระบุบัญชีรับเงิน" /></div>
        <div className="md:col-span-2"><label className={labelCls}>หมายเหตุ</label><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={3} disabled={submitLocked} className={inputCls} placeholder="รายละเอียดการมัดจำหรือสินค้าที่สั่ง..." /></div>
      </div>
      <p className="mt-4 rounded-lg border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-200">เงินมัดจำรับเข้าบัญชีทันที ไม่กระทบสต็อกหรือรายได้ และนำไปหักผ่านใบเสร็จรับเงินได้หลายครั้งจนยอดคงเหลือหมด</p>
    </div>
    <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
      {error ? <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-300">{error}</p> : null}
      {success ? <p className="mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-400/30 dark:bg-green-500/10 dark:text-green-300"><CheckCircle size={16} />{success}</p> : null}
      <div className="flex justify-end gap-3"><button type="button" onClick={() => router.back()} className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-white/20 dark:text-slate-300 dark:hover:bg-white/5">ยกเลิก</button><button type="button" onClick={submit} disabled={isPending || submitLocked} className="rounded-lg bg-[#1e3a5f] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#162d4a] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sky-700 dark:hover:bg-sky-600">{isPending ? "กำลังบันทึก..." : isEdit ? "บันทึกการแก้ไข" : "บันทึกรับเงินมัดจำ"}</button></div>
    </div>
  </div>;
}
