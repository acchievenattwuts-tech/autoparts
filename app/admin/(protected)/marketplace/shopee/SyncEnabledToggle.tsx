"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

import { setSyncEnabledAction } from "./actions";

const SyncEnabledToggle = ({
  shopRecordId,
  enabled,
}: {
  shopRecordId: string;
  enabled: boolean;
}) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    const fd = new FormData();
    fd.set("shopRecordId", shopRecordId);
    fd.set("enabled", enabled ? "0" : "1");
    startTransition(async () => {
      const res = await setSyncEnabledAction(fd);
      if (res.ok) router.refresh();
    });
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-600 dark:text-slate-300">ดึงออเดอร์อัตโนมัติ (cron ทุก 30 นาที)</p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          {enabled ? "เปิดอยู่ — ระบบดึงออเดอร์ให้เอง" : "ปิดอยู่ — ต้องกดดึงเอง"}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={handleToggle}
        disabled={isPending}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
          enabled ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600",
        )}
      >
        <span
          className={cn(
            "inline-flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform",
            enabled ? "translate-x-5" : "translate-x-0.5",
          )}
        >
          {isPending ? <Loader2 size={12} className="animate-spin text-slate-500" /> : null}
        </span>
      </button>
    </div>
  );
};

export default SyncEnabledToggle;
