"use client";

import { useState, useTransition } from "react";
import { createExpenseCode, deleteExpenseCode } from "./actions";
import { Trash2, Plus, CheckCircle } from "lucide-react";

interface ExpenseCode {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  _count: { items: number };
}

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm";

export const ExpenseCodeForm = () => {
  const [isPending, startTransition] = useTransition();
  const [error, setError]   = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(""); setSuccess("");
    const form = e.currentTarget;
    const fd = new FormData(form);
    startTransition(async () => {
      const res = await createExpenseCode(fd);
      if (res.error) { setError(res.error); return; }
      setSuccess(`บันทึกสำเร็จ (รหัส: ${res.code})`);
      form.reset();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h2 className="font-kanit text-base font-semibold text-[#1e3a5f] mb-4">เพิ่มรหัสค่าใช้จ่ายใหม่</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            ชื่อ <span className="text-red-500">*</span>
          </label>
          <input name="name" required maxLength={100} placeholder="เช่น ค่าไฟฟ้า" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">คำอธิบาย</label>
          <input name="description" maxLength={200} placeholder="(ไม่บังคับ)" className={inputCls} />
        </div>
      </div>
      {error   && <p className="text-red-600 text-sm mt-2">{error}</p>}
      {success && (
        <div className="flex items-center gap-1.5 text-green-600 text-sm mt-2">
          <CheckCircle size={14} /> {success}
        </div>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
      >
        <Plus size={14} /> {isPending ? "กำลังบันทึก..." : "เพิ่มรหัส"}
      </button>
    </form>
  );
};

export const ExpenseCodeDeleteButton = ({ id, name, disabled }: { id: string; name: string; disabled?: boolean }) => {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const handleDelete = () => {
    if (!confirm(`ลบรหัส "${name}" ออกจากระบบ?`)) return;
    setError("");
    startTransition(async () => {
      const res = await deleteExpenseCode(id);
      if (res.error) setError(res.error);
    });
  };

  return (
    <div>
      <button
        onClick={handleDelete}
        disabled={isPending || disabled}
        title={disabled ? "มีรายการค่าใช้จ่ายอ้างอิงอยู่" : "ลบ"}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-red-500 hover:bg-red-50 rounded-lg text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Trash2 size={13} /> {isPending ? "..." : "ลบ"}
      </button>
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
};
