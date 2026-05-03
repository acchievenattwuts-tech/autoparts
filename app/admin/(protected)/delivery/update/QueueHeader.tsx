"use client";

import { ArrowLeft, Check, GripVertical, Loader2 } from "lucide-react";

type Mode = "view" | "reorder";

type Props = {
  mode:        Mode;
  totalCount:  number;
  isPending:   boolean;
  canReorder:  boolean;
  onEnter:     () => void;
  onCancel:    () => void;
  onSave:      () => void;
  hasChanges:  boolean;
};

const QueueHeader = ({
  mode,
  totalCount,
  isPending,
  canReorder,
  onEnter,
  onCancel,
  onSave,
  hasChanges,
}: Props) => {
  if (mode === "reorder") {
    return (
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="inline-flex h-10 items-center gap-1 rounded-full px-3 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-white/10"
        >
          <ArrowLeft size={16} />
          ยกเลิก
        </button>
        <div className="text-center">
          <p className="font-kanit text-base font-bold text-gray-900 dark:text-slate-100">
            จัดเรียงคิว
          </p>
          <p className="text-[11px] text-gray-500 dark:text-slate-400">
            ลากการ์ดเพื่อจัดลำดับ
          </p>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={isPending || !hasChanges}
          className="inline-flex h-10 items-center gap-1 rounded-full bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300 dark:disabled:bg-emerald-700/30"
        >
          {isPending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Check size={16} />
          )}
          เสร็จสิ้น
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-kanit text-xl font-bold leading-tight text-gray-900 dark:text-slate-100">
          คิวจัดส่ง
        </h1>
        <p className="text-xs text-gray-500 dark:text-slate-400">
          {totalCount.toLocaleString("th-TH")} งาน
        </p>
      </div>
      <button
        type="button"
        onClick={onEnter}
        disabled={!canReorder}
        className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-sky-400 dark:hover:text-sky-200"
      >
        <GripVertical size={16} />
        จัดเรียงคิว
      </button>
    </div>
  );
};

export { type Mode };
export default QueueHeader;
