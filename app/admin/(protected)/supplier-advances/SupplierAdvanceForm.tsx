"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle } from "lucide-react";
import AdminNumberInput from "@/components/shared/AdminNumberInput";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import PaymentChannelsInput, { type PaymentChannelRow } from "@/components/shared/PaymentChannelsInput";
import { createSupplierAdvance, updateSupplierAdvance } from "./actions";
import { getThailandDateKey } from "@/lib/th-date";

type SupplierOption = {
  id: string;
  name: string;
  code: string | null;
  phone: string | null;
};

type CashBankAccountOption = {
  id: string;
  name: string;
  code: string;
  type: "CASH" | "BANK";
  bankName: string | null;
  accountNo: string | null;
};

type InitialData = {
  id: string;
  supplierId: string;
  advanceDate: string;
  totalAmount: number;
  cashBankAccountId: string;
  payments?: PaymentChannelRow[];
  note: string;
};

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/20 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500";
const labelCls = "mb-1.5 block text-sm font-medium text-gray-700 dark:text-slate-300";

const SupplierAdvanceForm = ({
  suppliers,
  cashBankAccounts,
  initialData,
  submitLocked = false,
}: {
  suppliers: SupplierOption[];
  cashBankAccounts: CashBankAccountOption[];
  initialData?: InitialData;
  submitLocked?: boolean;
}) => {
  const router = useRouter();
  const isEdit = !!initialData;
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [supplierId, setSupplierId] = useState(initialData?.supplierId ?? "");
  const [payments, setPayments] = useState<PaymentChannelRow[]>(
    initialData?.payments && initialData.payments.length > 0
      ? initialData.payments
      : initialData?.cashBankAccountId
        ? [{ cashBankAccountId: initialData.cashBankAccountId, amount: 0 }]
        : [{ cashBankAccountId: "", amount: 0 }],
  );
  const [advanceDate, setAdvanceDate] = useState(
    initialData?.advanceDate ?? getThailandDateKey(),
  );
  const [totalAmount, setTotalAmount] = useState(initialData?.totalAmount ?? 0);
  const [note, setNote] = useState(initialData?.note ?? "");

  const supplierOptions: SelectOption[] = suppliers.map((supplier) => ({
    id: supplier.id,
    label: supplier.name,
    sublabel: [supplier.code, supplier.phone].filter(Boolean).join(" | ") || undefined,
  }));

  const handleSubmit = () => {
    setError("");
    setSuccess("");

    if (submitLocked) return;

    if (!supplierId) {
      setError("กรุณาเลือกซัพพลายเออร์");
      return;
    }
    if (!advanceDate) {
      setError("กรุณาระบุวันที่");
      return;
    }
    if (totalAmount <= 0) {
      setError("ยอดเงินมัดจำต้องมากกว่า 0");
      return;
    }

    const activePayments = payments.filter((row) => row.amount > 0);
    if (activePayments.length === 0) { setError("กรุณาระบุช่องทางจ่ายเงินอย่างน้อย 1 ช่องทาง"); return; }
    if (activePayments.some((row) => !row.cashBankAccountId)) { setError("กรุณาเลือกบัญชีให้ครบทุกช่องทางที่มียอดเงิน"); return; }
    const paymentsTotal = Math.round(activePayments.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    if (Math.abs(paymentsTotal - totalAmount) > 0.005) {
      setError(`ยอดรวมช่องทางจ่ายเงินต้องเท่ากับยอดเงินมัดจำ (${totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท)`);
      return;
    }

    const formData = new FormData();
    formData.set("supplierId", supplierId);
    formData.set("advanceDate", advanceDate);
    formData.set("totalAmount", String(totalAmount));
    formData.set(
      "payments",
      JSON.stringify(activePayments.map((row) => ({ cashBankAccountId: row.cashBankAccountId, amount: row.amount }))),
    );
    formData.set("note", note);

    startTransition(async () => {
      if (isEdit && initialData) {
        const result = await updateSupplierAdvance(initialData.id, formData);
        if (result.error) {
          setError(result.error);
          return;
        }
        router.push("/admin/supplier-advances");
        return;
      }

      const result = await createSupplierAdvance(formData);
      if (result.error) {
        setError(result.error);
        return;
      }

      setSuccess(`บันทึกสำเร็จ เลขที่เอกสาร: ${result.advanceNo}`);
      setTimeout(() => router.push("/admin/supplier-advances"), 1500);
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
        <h2 className="mb-5 border-b border-gray-100 pb-3 font-kanit text-lg font-semibold text-[#1e3a5f] dark:border-white/10 dark:text-sky-300">
          ข้อมูลเงินมัดจำซัพพลายเออร์
        </h2>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className={labelCls}>
              วันที่เอกสาร <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={advanceDate}
              onChange={(event) => setAdvanceDate(event.target.value)}
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>
              ซัพพลายเออร์ <span className="text-red-500">*</span>
            </label>
            <SearchableSelect
              options={supplierOptions}
              value={supplierId}
              onChange={setSupplierId}
              placeholder="โปรดระบุซัพพลายเออร์"
            />
          </div>

          <div>
            <label className={labelCls}>
              จำนวนเงินมัดจำ <span className="text-red-500">*</span>
            </label>
            <AdminNumberInput
              min={0.01}
              step={0.01}
              value={totalAmount}
              onValueChange={setTotalAmount}
              className={inputCls}
              placeholder="0.00"
            />
          </div>

          <div>
            <PaymentChannelsInput
              accounts={cashBankAccounts}
              value={payments}
              onChange={setPayments}
              targetAmount={totalAmount}
              label="ช่องทางจ่ายเงิน"
              placeholder="โปรดระบุบัญชีจ่ายเงิน"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              ระบบจะลงรายการเงินออกจากบัญชีเหล่านี้ให้อัตโนมัติ
            </p>
          </div>

          <div className="md:col-span-2">
            <label className={labelCls}>หมายเหตุ</label>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={500}
              className={`${inputCls} resize-none`}
              placeholder="ระบุรายละเอียดเพิ่มเติม (ถ้ามี)"
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-blue-300">
        เงินมัดจำซัพพลายเออร์เป็นเอกสารจ่ายล่วงหน้าที่ไม่กระทบสต็อก และยอดคงเหลือจะถูกนำไปหักตอนทำเอกสารจ่ายชำระซัพพลายเออร์ภายหลัง
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-400/30 dark:bg-red-500/10">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      ) : null}

      {success ? (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 dark:border-green-400/30 dark:bg-green-500/10">
          <CheckCircle size={16} className="text-green-600 dark:text-green-400" />
          <p className="text-sm text-green-600 dark:text-green-400">{success}</p>
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending || submitLocked}
          className="inline-flex items-center gap-2 rounded-lg bg-[#f97316] px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "กำลังบันทึก..." : isEdit ? "บันทึกการแก้ไข" : "บันทึกเงินมัดจำ"}
        </button>
      </div>
    </div>
  );
};

export default SupplierAdvanceForm;
