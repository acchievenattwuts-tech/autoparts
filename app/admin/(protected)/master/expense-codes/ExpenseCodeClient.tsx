"use client";

import { useState, useTransition } from "react";
import { createExpenseCode, toggleExpenseCode, updateExpenseCode } from "./actions";
import { Plus, CheckCircle, Pencil, Check, X } from "lucide-react";

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]";

export const ExpenseCodeForm = () => {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      const result = await createExpenseCode(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess(`บันทึกสำเร็จ (รหัส: ${result.code})`);
      form.reset();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
      <h2 className="mb-4 font-kanit text-base font-semibold text-[#1e3a5f]">เพิ่มรหัสค่าใช้จ่ายใหม่</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            ชื่อ <span className="text-red-500">*</span>
          </label>
          <input name="name" required maxLength={100} placeholder="เช่น ค่าไฟฟ้า" className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">คำอธิบาย</label>
          <input name="description" maxLength={200} placeholder="(ไม่บังคับ)" className={inputCls} />
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {success && (
        <div className="mt-2 flex items-center gap-1.5 text-sm text-green-600">
          <CheckCircle size={14} /> {success}
        </div>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60"
      >
        <Plus size={14} /> {isPending ? "กำลังบันทึก..." : "เพิ่มรหัส"}
      </button>
    </form>
  );
};

export const ExpenseCodeToggleButton = ({
  id,
  name,
  isActive,
}: {
  id: string;
  name: string;
  isActive: boolean;
}) => {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const handleToggle = () => {
    const action = isActive ? "ยกเลิก" : "เปิดใช้งาน";
    if (!confirm(`${action}รหัส "${name}" ใช่หรือไม่?`)) return;
    setError("");
    startTransition(async () => {
      const result = await toggleExpenseCode(id, !isActive);
      if (result.error) setError(result.error);
    });
  };

  return (
    <div>
      <button
        onClick={handleToggle}
        disabled={isPending}
        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
          isActive ? "text-red-500 hover:bg-red-50" : "text-green-600 hover:bg-green-50"
        }`}
      >
        {isPending ? "..." : isActive ? "ยกเลิก" : "เปิดใช้งาน"}
      </button>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
};

export const ExpenseCodeRow = ({
  expenseCode,
  canUpdate,
  canCancel,
}: {
  expenseCode: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    isActive: boolean;
    _count: { items: number };
  };
  canUpdate: boolean;
  canCancel: boolean;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const handleUpdate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await updateExpenseCode(expenseCode.id, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setIsEditing(false);
    });
  };

  if (isEditing && canUpdate) {
    return (
      <tr className="border-t border-gray-100 bg-blue-50">
        <td colSpan={6} className="px-4 py-4">
          <form onSubmit={handleUpdate} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[160px_1fr_1fr]">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">รหัส</label>
                <input value={expenseCode.code} readOnly className={`${inputCls} bg-gray-50 text-gray-500`} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  ชื่อ <span className="text-red-500">*</span>
                </label>
                <input
                  name="name"
                  required
                  maxLength={100}
                  defaultValue={expenseCode.name}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">คำอธิบาย</label>
                <input
                  name="description"
                  maxLength={200}
                  defaultValue={expenseCode.description ?? ""}
                  className={inputCls}
                />
              </div>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60"
              >
                <Check size={14} />
                {isPending ? "กำลังบันทึก..." : "บันทึก"}
              </button>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-300 disabled:opacity-60"
              >
                <X size={14} />
                ยกเลิก
              </button>
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr
      className={`border-t border-gray-50 transition-colors ${
        expenseCode.isActive ? "hover:bg-gray-50" : "bg-gray-50 opacity-60"
      }`}
    >
      <td className="px-4 py-3 font-mono font-medium text-[#1e3a5f]">{expenseCode.code}</td>
      <td className="px-4 py-3 font-medium text-gray-800">{expenseCode.name}</td>
      <td className="px-4 py-3 text-gray-500">
        {expenseCode.description ?? <span className="text-gray-300">-</span>}
      </td>
      <td className="px-4 py-3 text-center">
        {expenseCode.isActive ? (
          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">ใช้งาน</span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-500">ยกเลิก</span>
        )}
      </td>
      <td className="px-4 py-3 text-center text-gray-500">{expenseCode._count.items}</td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          {canUpdate && (
            <button
              onClick={() => setIsEditing(true)}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#1e3a5f] transition-colors hover:bg-blue-50 disabled:opacity-40"
            >
              <Pencil size={12} />
              แก้ไข
            </button>
          )}
          {canCancel ? (
            <ExpenseCodeToggleButton
              id={expenseCode.id}
              name={expenseCode.name}
              isActive={expenseCode.isActive}
            />
          ) : !canUpdate ? (
            <span className="text-xs text-gray-300">-</span>
          ) : null}
        </div>
      </td>
    </tr>
  );
};
