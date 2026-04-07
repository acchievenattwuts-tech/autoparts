"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCashBankAccount, seedDefaultCashBankAccounts, updateCashBankAccount } from "./actions";

type AccountType = "CASH" | "BANK";

export type CashBankAccountRow = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  bankName: string | null;
  accountNo: string | null;
  openingBalance: number;
  openingDate: string;
  isActive: boolean;
};

type Props = {
  accounts: CashBankAccountRow[];
  canManage: boolean;
};

type FormState = {
  accountId: string | null;
  code: string;
  name: string;
  type: AccountType;
  bankName: string;
  accountNo: string;
  openingBalance: string;
  openingDate: string;
  isActive: boolean;
};

function emptyFormState(): FormState {
  return {
    accountId: null,
    code: "",
    name: "",
    type: "CASH",
    bankName: "",
    accountNo: "",
    openingBalance: "0",
    openingDate: new Date().toISOString().slice(0, 10),
    isActive: true,
  };
}

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]";

export default function CashBankAccountManager({ accounts, canManage }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(emptyFormState);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isPending, startTransition] = useTransition();

  const sortedAccounts = useMemo(
    () => [...accounts].sort((left, right) => left.code.localeCompare(right.code)),
    [accounts],
  );

  if (!canManage) {
    return null;
  }

  const handleEdit = (account: CashBankAccountRow) => {
    setForm({
      accountId: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      bankName: account.bankName ?? "",
      accountNo: account.accountNo ?? "",
      openingBalance: String(account.openingBalance),
      openingDate: account.openingDate,
      isActive: account.isActive,
    });
    setError("");
    setSuccess("");
  };

  const resetForm = () => {
    setForm(emptyFormState());
    setError("");
    setSuccess("");
  };

  const handleSubmit = () => {
    setError("");
    setSuccess("");

    if (!form.code.trim()) {
      setError("กรุณาระบุรหัสบัญชีก่อนบันทึก");
      return;
    }
    if (!form.name.trim()) {
      setError("กรุณาระบุชื่อบัญชีก่อนบันทึก");
      return;
    }
    if (!form.openingDate) {
      setError("กรุณาระบุวันที่ยอดยกมา");
      return;
    }
    if (form.type === "BANK" && !form.bankName.trim()) {
      setError("บัญชีประเภทธนาคารต้องระบุชื่อธนาคาร");
      return;
    }
    if (form.type === "BANK" && !form.accountNo.trim()) {
      setError("บัญชีประเภทธนาคารต้องระบุเลขที่บัญชี");
      return;
    }

    const formData = new FormData();
    formData.set("code", form.code);
    formData.set("name", form.name);
    formData.set("type", form.type);
    formData.set("bankName", form.bankName);
    formData.set("accountNo", form.accountNo);
    formData.set("openingBalance", form.openingBalance);
    formData.set("openingDate", form.openingDate);
    formData.set("isActive", String(form.isActive));

    startTransition(async () => {
      const result = form.accountId
        ? await updateCashBankAccount(form.accountId, formData)
        : await createCashBankAccount(formData);

      if (result?.error) {
        setError(result.error);
        return;
      }

      setSuccess(form.accountId ? "บันทึกการแก้ไขบัญชีแล้ว" : "สร้างบัญชีใหม่แล้ว");
      router.refresh();
      resetForm();
    });
  };

  const handleSeedDefaults = () => {
    setError("");
    setSuccess("");

    startTransition(async () => {
      const result = await seedDefaultCashBankAccounts();
      if (result?.error) {
        setError(result.error);
        return;
      }

      setSuccess(result?.message ?? "สร้างบัญชีตั้งต้นเรียบร้อยแล้ว");
      router.refresh();
    });
  };

  return (
    <div className="space-y-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-kanit text-lg font-semibold text-gray-900">
            {form.accountId ? "แก้ไขบัญชีเงิน" : "เพิ่มบัญชีเงิน"}
          </h2>
          <p className="text-sm text-gray-500">
            ใช้กำหนดบัญชีเงินสดหรือธนาคารสำหรับ movement และรายงาน cash/bank
          </p>
        </div>
        {form.accountId && (
          <button
            type="button"
            onClick={resetForm}
            className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200"
          >
            ล้างฟอร์ม
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {success}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">รหัสบัญชี</label>
          <input className={inputCls} value={form.code} onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">ชื่อบัญชี</label>
          <input className={inputCls} value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">ประเภท</label>
          <select
            className={`${inputCls} bg-white`}
            value={form.type}
            onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value as AccountType }))}
          >
            <option value="CASH">เงินสด</option>
            <option value="BANK">ธนาคาร</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">ยอดยกมา</label>
          <input
            type="number"
            step={0.01}
            className={inputCls}
            value={form.openingBalance}
            onChange={(e) => setForm((prev) => ({ ...prev, openingBalance: e.target.value }))}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">วันที่ยอดยกมา</label>
          <input
            type="date"
            className={inputCls}
            value={form.openingDate}
            onChange={(e) => setForm((prev) => ({ ...prev, openingDate: e.target.value }))}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">ธนาคาร</label>
          <input
            className={inputCls}
            value={form.bankName}
            onChange={(e) => setForm((prev) => ({ ...prev, bankName: e.target.value }))}
            disabled={form.type !== "BANK"}
            placeholder={form.type === "BANK" ? "เช่น Kasikornbank" : "ใช้เฉพาะบัญชีธนาคาร"}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">เลขที่บัญชี</label>
          <input
            className={inputCls}
            value={form.accountNo}
            onChange={(e) => setForm((prev) => ({ ...prev, accountNo: e.target.value }))}
            disabled={form.type !== "BANK"}
            placeholder={form.type === "BANK" ? "ระบุเลขที่บัญชี" : "ใช้เฉพาะบัญชีธนาคาร"}
          />
        </div>
        <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
          />
          ใช้งานบัญชีนี้
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          className="rounded-lg bg-[#1e3a5f] px-5 py-2 text-sm font-medium text-white hover:bg-[#163055] disabled:opacity-60"
        >
          {isPending ? "กำลังบันทึก..." : form.accountId ? "บันทึกการแก้ไข" : "เพิ่มบัญชี"}
        </button>
        <button
          type="button"
          onClick={handleSeedDefaults}
          disabled={isPending}
          className="rounded-lg bg-emerald-50 px-5 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
        >
          {isPending ? "กำลังประมวลผล..." : "สร้างบัญชีตั้งต้น"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">รหัส</th>
              <th className="px-3 py-2 text-left font-medium">ชื่อบัญชี</th>
              <th className="px-3 py-2 text-left font-medium">ประเภท</th>
              <th className="px-3 py-2 text-left font-medium">รายละเอียด</th>
              <th className="px-3 py-2 text-right font-medium">ยอดยกมา</th>
              <th className="px-3 py-2 text-center font-medium">สถานะ</th>
              <th className="px-3 py-2 text-right font-medium">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {sortedAccounts.map((account) => (
              <tr key={account.id} className="border-t border-gray-100">
                <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f]">{account.code}</td>
                <td className="px-3 py-2 text-gray-900">{account.name}</td>
                <td className="px-3 py-2 text-gray-600">{account.type}</td>
                <td className="px-3 py-2 text-gray-500">
                  {[account.bankName, account.accountNo].filter(Boolean).join(" | ") || "-"}
                </td>
                <td className="px-3 py-2 text-right font-medium text-gray-800">
                  {account.openingBalance.toLocaleString("th-TH", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </td>
                <td className="px-3 py-2 text-center">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      account.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {account.isActive ? "ใช้งาน" : "ปิดใช้งาน"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => handleEdit(account)}
                    className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
                  >
                    แก้ไข
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
