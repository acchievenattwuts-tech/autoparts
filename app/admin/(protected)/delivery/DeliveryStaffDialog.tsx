"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Loader2, UserRound, X } from "lucide-react";

import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";

type Props = {
  title: string;
  description: string;
  confirmLabel: string;
  saleNo: string;
  staffOptions: SelectOption[];
  initialStaffId: string | null;
  isPending: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (staffId: string) => void;
};

/** Mount only while the dialog should be visible — the parent unmounts it to reset state. */
const DeliveryStaffDialog = ({
  title,
  description,
  confirmLabel,
  saleNo,
  staffOptions,
  initialStaffId,
  isPending,
  error,
  onClose,
  onConfirm,
}: Props) => {
  const [staffId, setStaffId] = useState(initialStaffId ?? "");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isPending) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isPending, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-[#111c30] dark:ring-1 dark:ring-white/10">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-kanit text-lg font-bold text-gray-900 dark:text-slate-100">{title}</h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
              เลขที่ใบขาย <span className="font-mono">{saleNo}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-100"
            aria-label="ปิด"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mb-3 text-sm text-gray-600 dark:text-slate-300">{description}</p>

        <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-slate-200">
          <UserRound size={14} /> ผู้ส่ง <span className="text-red-500">*</span>
        </label>
        <SearchableSelect
          options={staffOptions}
          value={staffId}
          onChange={setStaffId}
          placeholder="เลือกผู้ส่ง"
          disabled={isPending}
        />

        {staffOptions.length === 0 ? (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">
            ไม่พบผู้ใช้ที่เปิดใช้งาน กรุณาตรวจสอบข้อมูลผู้ใช้ก่อน
          </p>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-rose-500/10 dark:text-rose-300">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/10"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={() => onConfirm(staffId)}
            disabled={isPending || !staffId}
            className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-700"
          >
            {isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeliveryStaffDialog;
