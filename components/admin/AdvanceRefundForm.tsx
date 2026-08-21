"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import AdminNumberInput from "@/components/shared/AdminNumberInput";
import PaymentChannelsInput, {
  type PaymentChannelAccount,
  type PaymentChannelRow,
} from "@/components/shared/PaymentChannelsInput";
import SearchableSelect, {
  type SelectOption,
} from "@/components/shared/SearchableSelect";
import {
  createCustomerAdvanceRefund,
  createSupplierAdvanceRefund,
  updateCustomerAdvanceRefund,
  updateSupplierAdvanceRefund,
} from "@/lib/advance-refund-actions";
import { getThailandDateKey } from "@/lib/th-date";

export type AdvanceRefundOption = {
  id: string;
  advanceNo: string;
  partyName: string;
  amountRemain: number;
};

type InitialData = {
  id: string;
  sourceAdvanceId: string;
  refundDate: string;
  refundAmount: number;
  sourceAmountRemain: number;
  payments: PaymentChannelRow[];
  note: string;
};

export default function AdvanceRefundForm({
  side,
  advances,
  cashBankAccounts,
  initialData,
}: {
  side: "CUSTOMER" | "SUPPLIER";
  advances: AdvanceRefundOption[];
  cashBankAccounts: PaymentChannelAccount[];
  initialData?: InitialData;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [sourceAdvanceId, setSourceAdvanceId] = useState(
    initialData?.sourceAdvanceId ?? "",
  );
  const [refundDate, setRefundDate] = useState(
    initialData?.refundDate ?? getThailandDateKey(),
  );
  const [refundAmount, setRefundAmount] = useState(
    initialData?.refundAmount ?? 0,
  );
  const [payments, setPayments] = useState<PaymentChannelRow[]>(
    initialData?.payments ?? [{ cashBankAccountId: "", amount: 0 }],
  );
  const [note, setNote] = useState(initialData?.note ?? "");
  const isEdit = Boolean(initialData);
  const selected = advances.find((advance) => advance.id === sourceAdvanceId);
  const maxRefund = isEdit
    ? (initialData?.sourceAmountRemain ?? 0) + (initialData?.refundAmount ?? 0)
    : (selected?.amountRemain ?? 0);
  const isCustomer = side === "CUSTOMER";
  const listPath = isCustomer
    ? "/admin/customer-advance-refunds"
    : "/admin/supplier-advance-refunds";
  const options = useMemo<SelectOption[]>(
    () =>
      advances.map((advance) => ({
        id: advance.id,
        label: advance.advanceNo,
        sublabel: `${advance.partyName} · คงเหลือ ${advance.amountRemain.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท`,
        disabled: !isEdit && advance.amountRemain <= 0,
      })),
    [advances, isEdit],
  );

  const submit = () => {
    setError("");
    if (!sourceAdvanceId) return setError("กรุณาเลือกเอกสารมัดจำต้นทาง");
    if (refundAmount <= 0) return setError("ยอดคืนต้องมากกว่า 0");
    if (refundAmount - maxRefund > 0.005)
      return setError(
        `ยอดคืนต้องไม่เกิน ${maxRefund.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท`,
      );
    const activePayments = payments.filter(
      (row) => row.cashBankAccountId && row.amount > 0,
    );
    const formData = new FormData();
    formData.set("sourceAdvanceId", sourceAdvanceId);
    formData.set("refundDate", refundDate);
    formData.set("refundAmount", String(refundAmount));
    formData.set("note", note);
    formData.set("payments", JSON.stringify(activePayments));
    startTransition(async () => {
      const result = initialData
        ? isCustomer
          ? await updateCustomerAdvanceRefund(initialData.id, formData)
          : await updateSupplierAdvanceRefund(initialData.id, formData)
        : isCustomer
          ? await createCustomerAdvanceRefund(formData)
          : await createSupplierAdvanceRefund(formData);
      if (result.error) return setError(result.error);
      const id =
        initialData?.id ?? ("refundId" in result ? result.refundId : undefined);
      if (id) router.push(`${listPath}/${id}`);
      else router.push(listPath);
      router.refresh();
    });
  };

  const inputCls =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/20 dark:bg-slate-900 dark:text-slate-100";
  const labelCls =
    "mb-1.5 block text-sm font-medium text-gray-700 dark:text-slate-300";

  return (
    <div className="space-y-6">
      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-300">
          <AlertCircle className="mt-0.5 shrink-0" size={16} />
          {error}
        </div>
      ) : null}
      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label className={labelCls}>
              เอกสารมัดจำต้นทาง <span className="text-red-500">*</span>
            </label>
            <SearchableSelect
              options={options}
              value={sourceAdvanceId}
              onChange={setSourceAdvanceId}
              disabled={isEdit}
              placeholder={
                isCustomer
                  ? "เลือกเอกสารรับเงินมัดจำลูกค้า"
                  : "เลือกเอกสารมัดจำซัพพลายเออร์"
              }
            />
            {isEdit ? (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
                เอกสารต้นทางถูกล็อกและไม่สามารถเปลี่ยนได้
              </p>
            ) : null}
          </div>
          <div>
            <label className={labelCls}>
              วันที่เอกสาร <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={refundDate}
              onChange={(event) => setRefundDate(event.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>ยอดคงเหลือที่คืนได้</label>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 font-kanit text-lg font-semibold text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300">
              {maxRefund.toLocaleString("th-TH", { minimumFractionDigits: 2 })}{" "}
              บาท
            </div>
          </div>
          <div>
            <label className={labelCls}>
              ยอดที่ทำคืน <span className="text-red-500">*</span>
            </label>
            <AdminNumberInput
              min={0.01}
              max={maxRefund || undefined}
              step={0.01}
              value={refundAmount}
              onValueChange={setRefundAmount}
              className={`${inputCls} text-right`}
            />
          </div>
          <div className="md:col-span-2">
            <PaymentChannelsInput
              accounts={cashBankAccounts}
              value={payments}
              onChange={setPayments}
              targetAmount={refundAmount}
              label={
                isCustomer
                  ? "ช่องทางคืนเงินให้ลูกค้า"
                  : "ช่องทางรับเงินคืนจากซัพพลายเออร์"
              }
              placeholder={
                isCustomer ? "เลือกบัญชีจ่ายเงิน" : "เลือกบัญชีรับเงิน"
              }
            />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>หมายเหตุ</label>
            <textarea
              rows={3}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className={inputCls}
            />
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-3 rounded-xl border border-gray-100 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-white/20 dark:text-slate-300 dark:hover:bg-white/5"
        >
          ยกเลิก
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="rounded-lg bg-[#1e3a5f] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#162d4a] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sky-700 dark:hover:bg-sky-600"
        >
          {isPending
            ? "กำลังบันทึก..."
            : isEdit
              ? "บันทึกการแก้ไข"
              : isCustomer
                ? "บันทึกคืนเงินมัดจำ"
                : "บันทึกรับคืนเงินมัดจำ"}
        </button>
      </div>
    </div>
  );
}
