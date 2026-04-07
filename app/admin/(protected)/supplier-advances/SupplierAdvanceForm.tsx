"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle } from "lucide-react";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import { createSupplierAdvance, updateSupplierAdvance } from "./actions";

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
  note: string;
};

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]";
const labelCls = "mb-1.5 block text-sm font-medium text-gray-700";

const SupplierAdvanceForm = ({
  suppliers,
  cashBankAccounts,
  initialData,
}: {
  suppliers: SupplierOption[];
  cashBankAccounts: CashBankAccountOption[];
  initialData?: InitialData;
}) => {
  const router = useRouter();
  const isEdit = !!initialData;
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [supplierId, setSupplierId] = useState(initialData?.supplierId ?? "");
  const [cashBankAccountId, setCashBankAccountId] = useState(initialData?.cashBankAccountId ?? "");
  const [advanceDate, setAdvanceDate] = useState(
    initialData?.advanceDate ?? new Date().toISOString().slice(0, 10),
  );
  const [totalAmount, setTotalAmount] = useState(initialData?.totalAmount ?? 0);
  const [note, setNote] = useState(initialData?.note ?? "");

  const supplierOptions: SelectOption[] = suppliers.map((supplier) => ({
    id: supplier.id,
    label: supplier.name,
    sublabel: [supplier.code, supplier.phone].filter(Boolean).join(" | ") || undefined,
  }));

  const accountOptions: SelectOption[] = cashBankAccounts.map((account) => ({
    id: account.id,
    label: account.name,
    sublabel:
      [account.code, account.type === "BANK" ? account.bankName : "เงินสด", account.accountNo]
        .filter(Boolean)
        .join(" | ") || undefined,
  }));

  const handleSubmit = () => {
    setError("");
    setSuccess("");

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
    if (!cashBankAccountId) {
      setError("กรุณาเลือกบัญชีจ่ายเงิน");
      return;
    }

    const formData = new FormData();
    formData.set("supplierId", supplierId);
    formData.set("advanceDate", advanceDate);
    formData.set("totalAmount", String(totalAmount));
    formData.set("cashBankAccountId", cashBankAccountId);
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
      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <h2 className="mb-5 border-b border-gray-100 pb-3 font-kanit text-lg font-semibold text-[#1e3a5f]">
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
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={totalAmount}
              onChange={(event) => setTotalAmount(Number(event.target.value))}
              className={inputCls}
              placeholder="0.00"
            />
          </div>

          <div>
            <label className={labelCls}>
              บัญชีจ่ายเงิน <span className="text-red-500">*</span>
            </label>
            <SearchableSelect
              options={accountOptions}
              value={cashBankAccountId}
              onChange={setCashBankAccountId}
              placeholder="โปรดระบุบัญชีจ่ายเงิน"
            />
            <p className="mt-1 text-xs text-gray-500">
              ระบบจะลงรายการเงินออกจากบัญชีนี้ให้อัตโนมัติ
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

      <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
        เงินมัดจำซัพพลายเออร์เป็นเอกสารจ่ายล่วงหน้าที่ไม่กระทบสต็อก และยอดคงเหลือจะถูกนำไปหักตอนทำเอกสารจ่ายชำระซัพพลายเออร์ภายหลัง
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      ) : null}

      {success ? (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <CheckCircle size={16} className="text-green-600" />
          <p className="text-sm text-green-600">{success}</p>
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-[#f97316] px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "กำลังบันทึก..." : isEdit ? "บันทึกการแก้ไข" : "บันทึกเงินมัดจำ"}
        </button>
      </div>
    </div>
  );
};

export default SupplierAdvanceForm;
