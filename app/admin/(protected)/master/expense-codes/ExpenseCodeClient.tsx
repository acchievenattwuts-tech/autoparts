"use client";

import { useState, useTransition } from "react";
import { createExpenseCode, toggleExpenseCode } from "./actions";
import { Plus, CheckCircle } from "lucide-react";

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
