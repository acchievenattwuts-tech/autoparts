"use client";

import { useState, useTransition } from "react";
import { createExpenseCode, toggleExpenseCode, updateExpenseCode } from "./actions";
import { Plus, CheckCircle, Pencil, Check, X } from "lucide-react";
import AdminActionGroup from "@/components/shared/AdminActionGroup";
import AdminSectionCard from "@/components/shared/AdminSectionCard";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import { getAdminActiveBadgeTone, getAdminMasterRowClass } from "@/lib/admin-status-presentation";

const inputCls =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/10 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-orange-400/30";
const labelCls = "mb-1 block text-xs font-medium text-gray-600 dark:text-slate-300";

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
    <AdminSectionCard>
      <form onSubmit={handleSubmit} className="space-y-3">
        <h2 className="font-kanit text-base font-semibold text-[#1e3a5f] dark:text-slate-50">เพิ่มรหัสค่าใช้จ่ายใหม่</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className={labelCls}>
            ชื่อ <span className="text-red-500">*</span>
          </label>
          <input name="name" required maxLength={100} placeholder="เช่น ค่าไฟฟ้า" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>คำอธิบาย</label>
          <input name="description" maxLength={200} placeholder="(ไม่บังคับ)" className={inputCls} />
        </div>
      </div>
      <label className="mt-3 flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900 dark:border-orange-400/20 dark:bg-orange-400/10 dark:text-orange-200">
        <input type="checkbox" name="isDeliveryCommission" className="mt-0.5 h-4 w-4 rounded border-orange-300" />
        <span>
          ใช้เป็นรหัสค่าใช้จ่ายสำหรับทำจ่ายค่าส่งพนักงาน
          <span className="block text-xs text-orange-700 dark:text-orange-200/80">
            เลือกได้เพียง 1 รหัส หากต้องการเปลี่ยนต้องเอาเครื่องหมายออกจากรหัสเดิมก่อน
          </span>
        </span>
      </label>
      {error && <p className="text-sm text-red-600 dark:text-red-300">{error}</p>}
      {success && (
        <div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-300">
          <CheckCircle size={14} /> {success}
        </div>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-60"
      >
        <Plus size={14} /> {isPending ? "กำลังบันทึก..." : "เพิ่มรหัส"}
      </button>
      </form>
    </AdminSectionCard>
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
          isActive
            ? "text-red-500 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10"
            : "text-green-600 hover:bg-green-50 dark:text-green-300 dark:hover:bg-green-500/10"
        }`}
      >
        {isPending ? "..." : isActive ? "ยกเลิก" : "เปิดใช้งาน"}
      </button>
      {error && <p className="mt-1 text-xs text-red-500 dark:text-red-300">{error}</p>}
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
    isDeliveryCommission: boolean;
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
      <tr className="border-t border-gray-100 bg-blue-50 dark:border-white/10 dark:bg-sky-500/10">
        <td colSpan={6} className="px-4 py-4">
          <form onSubmit={handleUpdate} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[160px_1fr_1fr]">
              <div>
                <label className={labelCls}>รหัส</label>
                <input value={expenseCode.code} readOnly className={`${inputCls} bg-gray-50 text-gray-500 dark:bg-slate-800 dark:text-slate-400`} />
              </div>
              <div>
                <label className={labelCls}>
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
                <label className={labelCls}>คำอธิบาย</label>
                <input
                  name="description"
                  maxLength={200}
                  defaultValue={expenseCode.description ?? ""}
                  className={inputCls}
                />
              </div>
            </div>
            <label className="flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900 dark:border-orange-400/20 dark:bg-orange-400/10 dark:text-orange-200">
              <input
                type="checkbox"
                name="isDeliveryCommission"
                defaultChecked={expenseCode.isDeliveryCommission}
                className="mt-0.5 h-4 w-4 rounded border-orange-300"
              />
              <span>
                ใช้เป็นรหัสค่าใช้จ่ายสำหรับทำจ่ายค่าส่งพนักงาน
                <span className="block text-xs text-orange-700 dark:text-orange-200/80">
                  เลือกได้เพียง 1 รหัส หากต้องการเปลี่ยนต้องเอาเครื่องหมายออกจากรหัสเดิมก่อน
                </span>
              </span>
            </label>
            {error && <p className="text-sm text-red-600 dark:text-red-300">{error}</p>}
            <AdminActionGroup align="start">
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
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-300 disabled:opacity-60 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <X size={14} />
                ยกเลิก
              </button>
            </AdminActionGroup>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr
      className={`border-t border-gray-50 transition-colors ${
        getAdminMasterRowClass(expenseCode.isActive)
      }`}
    >
      <td className="px-4 py-3 font-mono font-medium text-[#1e3a5f] dark:text-orange-200">{expenseCode.code}</td>
      <td className="px-4 py-3 font-medium text-gray-800 dark:text-slate-100">
        <div className="space-y-1">
          <p>{expenseCode.name}</p>
          {expenseCode.isDeliveryCommission && (
            <span className="inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-700 dark:bg-orange-400/10 dark:text-orange-200">
              ค่าส่งพนักงาน
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-gray-500 dark:text-slate-400">
        {expenseCode.description ?? <span className="text-gray-300 dark:text-slate-600">-</span>}
      </td>
      <td className="px-4 py-3 text-center">
        <AdminStatusBadge tone={getAdminActiveBadgeTone(expenseCode.isActive)}>
          {expenseCode.isActive ? "ใช้งาน" : "ยกเลิก"}
        </AdminStatusBadge>
      </td>
      <td className="px-4 py-3 text-center text-gray-500 dark:text-slate-400">{expenseCode._count.items}</td>
      <td className="px-4 py-3 text-right">
        <AdminActionGroup>
          {canUpdate && (
            <button
              onClick={() => setIsEditing(true)}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#1e3a5f] transition-colors hover:bg-blue-50 disabled:opacity-40 dark:text-sky-200 dark:hover:bg-sky-500/10"
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
            <span className="text-xs text-gray-300 dark:text-slate-600">-</span>
          ) : null}
        </AdminActionGroup>
      </td>
    </tr>
  );
};
