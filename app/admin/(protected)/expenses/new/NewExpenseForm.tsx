"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createExpense, updateExpense } from "../actions";
import { Plus, Trash2, CheckCircle } from "lucide-react";
import { calcVat, VAT_TYPE_LABELS, type VatType } from "@/lib/vat";
import AdminNumberInput from "@/components/shared/AdminNumberInput";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import PaymentChannelsInput, { type PaymentChannelRow } from "@/components/shared/PaymentChannelsInput";
import { getThailandDateKey } from "@/lib/th-date";

interface ExpenseCodeOption {
  id: string;
  code: string;
  name: string;
}

interface LineItem {
  expenseCodeId: string;
  description: string;
  amount: number;
}

interface CashBankAccountOption {
  id: string;
  name: string;
  code: string;
  type: "CASH" | "BANK";
  bankName: string | null;
  accountNo: string | null;
}

interface InitialData {
  id: string;
  expenseDate: string;
  cashBankAccountId: string;
  payments?: PaymentChannelRow[];
  vatType: string;
  vatRate: number;
  note: string;
  items: LineItem[];
}

interface Props {
  expenseCodes: ExpenseCodeOption[];
  cashBankAccounts: CashBankAccountOption[];
  defaultVatType: string;
  defaultVatRate: number;
  initialData?: InitialData;
}

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm dark:border-white/20 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500";
const labelCls = "block text-sm font-medium text-gray-700 mb-1 dark:text-slate-300";

const emptyItem = (): LineItem => ({ expenseCodeId: "", description: "", amount: 0 });

const NewExpenseForm = ({ expenseCodes, cashBankAccounts, defaultVatType, defaultVatRate, initialData }: Props) => {
  const router = useRouter();
  const isEdit = !!initialData;
  const [isPending, startTransition] = useTransition();
  const [error, setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState("");

  const [items, setItems]     = useState<LineItem[]>(initialData?.items ?? [emptyItem()]);
  const [payments, setPayments] = useState<PaymentChannelRow[]>(
    initialData?.payments && initialData.payments.length > 0
      ? initialData.payments
      : initialData?.cashBankAccountId
        ? [{ cashBankAccountId: initialData.cashBankAccountId, amount: 0 }]
        : [{ cashBankAccountId: "", amount: 0 }],
  );
  const [vatType, setVatType] = useState<string>(initialData?.vatType ?? defaultVatType);
  const [vatRate, setVatRate] = useState<number>(initialData?.vatRate ?? defaultVatRate);

  const addItem    = () => setItems((prev) => [...prev, emptyItem()]);
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));

  const updateItem = (i: number, field: keyof LineItem, value: string | number) => {
    setItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== i) return item;
        const updated = { ...item, [field]: value };
        if (field === "expenseCodeId") {
          const code = expenseCodes.find((c) => c.id === String(value));
          if (code && !updated.description) updated.description = code.name;
        }
        return updated;
      })
    );
  };

  const totalAmount = items.reduce((s, it) => s + it.amount, 0);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(totalAmount, vatType as VatType, vatRate);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null); setSuccess("");

    for (const item of items) {
      if (!item.expenseCodeId) { setError("กรุณาเลือกรหัสค่าใช้จ่ายทุกรายการ"); return; }
      if (item.amount <= 0)    { setError("จำนวนเงินต้องมากกว่า 0 ทุกรายการ"); return; }
    }

    const activePayments = payments.filter((row) => row.amount > 0);
    if (activePayments.length === 0) { setError("กรุณาระบุช่องทางจ่ายเงินอย่างน้อย 1 ช่องทาง"); return; }
    if (activePayments.some((row) => !row.cashBankAccountId)) { setError("กรุณาเลือกบัญชีให้ครบทุกช่องทางที่มียอดเงิน"); return; }
    const paymentsTotal = Math.round(activePayments.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    if (Math.abs(paymentsTotal - netAmount) > 0.005) {
      setError(`ยอดรวมช่องทางจ่ายเงินต้องเท่ากับยอดสุทธิ (${netAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท)`);
      return;
    }

    const fd = new FormData(e.currentTarget);
    fd.set("items", JSON.stringify(items));
    fd.set(
      "payments",
      JSON.stringify(activePayments.map((row) => ({ cashBankAccountId: row.cashBankAccountId, amount: row.amount }))),
    );
    fd.set("vatType", vatType);
    fd.set("vatRate", String(vatRate));

    startTransition(async () => {
      if (isEdit && initialData) {
        const res = await updateExpense(initialData.id, fd);
        if (res.error) { setError(res.error); return; }
        router.push("/admin/expenses");
      } else {
        const res = await createExpense(fd);
        if (res.error) { setError(res.error); return; }
        setSuccess(`บันทึกสำเร็จ เลขที่เอกสาร: ${res.expenseNo}`);
        setTimeout(() => router.push("/admin/expenses"), 1500);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg dark:bg-red-500/10 dark:border-red-400/30 dark:text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-lg flex items-center gap-2 dark:bg-green-500/10 dark:border-green-400/30 dark:text-green-400">
          <CheckCircle size={16} /> {success}
        </div>
      )}

      {/* Header */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className={labelCls}>วันที่ <span className="text-red-500">*</span></label>
          <input
            type="date"
            name="expenseDate"
              defaultValue={initialData?.expenseDate ?? getThailandDateKey()}
            required
            className={inputCls}
          />
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>หมายเหตุ</label>
          <input type="text" name="note" maxLength={500} defaultValue={initialData?.note ?? ""} placeholder="หมายเหตุเอกสาร (ถ้ามี)" className={inputCls} />
        </div>
      </div>

      {/* VAT Settings */}
      <div className="border-t border-gray-100 pt-4 dark:border-white/10">
        <p className="text-sm font-medium text-gray-700 mb-3 dark:text-slate-300">ภาษี (VAT)</p>
        <div className="flex flex-wrap gap-2 items-center">
          {(["NO_VAT", "EXCLUDING_VAT", "INCLUDING_VAT"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setVatType(t)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                vatType === t
                  ? "bg-[#1e3a5f] text-white border-[#1e3a5f] dark:bg-sky-700 dark:border-sky-700"
                  : "bg-white text-gray-600 border-gray-300 hover:border-gray-400 dark:bg-slate-800 dark:text-slate-300 dark:border-white/20 dark:hover:border-white/40"
              }`}
            >
              {VAT_TYPE_LABELS[t]}
            </button>
          ))}
          {vatType !== "NO_VAT" && (
            <div className="flex items-center gap-1.5 ml-2">
              <span className="text-sm text-gray-500 dark:text-slate-400">อัตรา</span>
              <AdminNumberInput
                value={vatRate}
                onValueChange={setVatRate}
                min={0} max={100} step={0.01}
                className="w-20 px-2 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm text-center dark:border-white/20 dark:bg-slate-900 dark:text-slate-100"
              />
              <span className="text-sm text-gray-500 dark:text-slate-400">%</span>
            </div>
          )}
        </div>
      </div>

      {/* Line Items */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-gray-700 dark:text-slate-300">รายการค่าใช้จ่าย</p>
          {expenseCodes.length === 0 ? (
            <p className="text-xs text-amber-600 bg-amber-50 px-3 py-1 rounded-lg dark:bg-amber-500/15 dark:text-amber-300">
              ยังไม่มีรหัสค่าใช้จ่าย —{" "}
              <a href="/admin/master/expense-codes" className="underline">เพิ่มรหัส</a>
            </p>
          ) : (
            <button
              type="button"
              onClick={addItem}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-gray-300 hover:border-[#1e3a5f] text-gray-500 hover:text-[#1e3a5f] text-sm rounded-lg transition-colors dark:border-white/20 dark:text-slate-400 dark:hover:border-sky-500 dark:hover:text-sky-300"
            >
              <Plus size={14} /> เพิ่มรายการ
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-white/10">
                <th className="text-left py-2 px-2 text-gray-500 font-medium dark:text-slate-400">รหัสค่าใช้จ่าย</th>
                <th className="text-left py-2 px-2 text-gray-500 font-medium dark:text-slate-400">รายละเอียด</th>
                <th className="text-left py-2 px-2 text-gray-500 font-medium w-40 dark:text-slate-400">จำนวนเงิน (บาท)</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i} className="border-b border-gray-50 dark:border-white/5">
                  <td className="py-2 px-2 w-56">
                    <SearchableSelect
                      options={expenseCodes.map((c): SelectOption => ({ id: c.id, label: c.name, sublabel: c.code }))}
                      value={item.expenseCodeId}
                      onChange={(id) => updateItem(i, "expenseCodeId", id)}
                      placeholder="โปรดระบุรหัส"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => updateItem(i, "description", e.target.value)}
                      maxLength={200}
                      placeholder="รายละเอียดเพิ่มเติม (ไม่บังคับ)"
                      className={inputCls}
                    />
                  </td>
                  <td className="py-2 px-2">
                    <AdminNumberInput
                      value={item.amount}
                      onValueChange={(value) => updateItem(i, "amount", value)}
                      min={0.01}
                      step={0.01}
                      placeholder="0.00"
                      className={inputCls}
                    />
                  </td>
                  <td className="py-2 px-2">
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(i)}
                        className="text-red-400 hover:text-red-600 transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-100 dark:border-white/10">
                <td colSpan={2} className="py-2 px-2 text-right text-sm text-gray-500 dark:text-slate-400">รวม</td>
                <td className="py-2 px-2 font-medium text-gray-700 dark:text-slate-200">
                  {totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </td>
                <td />
              </tr>
              {vatType !== "NO_VAT" && (
                <>
                  <tr>
                    <td colSpan={2} className="py-1 px-2 text-right text-sm text-gray-500 dark:text-slate-400">ยอดก่อนภาษี</td>
                    <td className="py-1 px-2 text-gray-700 dark:text-slate-200">
                      {subtotalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td />
                  </tr>
                  <tr>
                    <td colSpan={2} className="py-1 px-2 text-right text-sm text-gray-500 dark:text-slate-400">VAT {vatRate}%</td>
                    <td className="py-1 px-2 text-gray-700 dark:text-slate-200">
                      +{vatAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td />
                  </tr>
                </>
              )}
              <tr className="border-t border-gray-200 dark:border-white/10">
                <td colSpan={2} className="py-3 px-2 text-right text-sm font-semibold text-gray-700 dark:text-slate-300">ยอดสุทธิ</td>
                <td className="py-3 px-2 font-bold text-[#1e3a5f] text-base dark:text-sky-300">
                  {netAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Payment channels */}
      <div className="border-t border-gray-100 pt-4 dark:border-white/10">
        <PaymentChannelsInput
          accounts={cashBankAccounts}
          value={payments}
          onChange={setPayments}
          targetAmount={netAmount}
          label="ช่องทางจ่ายเงิน"
          placeholder="โปรดระบุบัญชีจ่ายเงิน"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending || expenseCodes.length === 0}
          className="px-6 py-2 bg-[#1e3a5f] hover:bg-[#163055] disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isPending ? "กำลังบันทึก..." : isEdit ? "บันทึกการแก้ไข" : "บันทึกค่าใช้จ่าย"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin/expenses")}
          className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-200"
        >
          ยกเลิก
        </button>
      </div>
    </form>
  );
};

export default NewExpenseForm;
