"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, HelpCircle, XCircle } from "lucide-react";

type Props = {
  slipId: string;
};

type Decision = "confirm" | "reject" | "needs_info";

export default function AdminPaymentSlipReviewActions({ slipId }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);

  const review = async (decision: Decision) => {
    setPending(decision);
    setError(null);
    try {
      const response = await fetch(`/api/admin/line-payment-slips/${slipId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? `REQUEST_FAILED_${response.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "REQUEST_FAILED");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => review("confirm")}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-200 px-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-400/30 dark:text-emerald-200 dark:hover:bg-emerald-500/10"
        >
          <CheckCircle2 size={15} />
          ยืนยันผลตรวจสลิป
        </button>
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => review("needs_info")}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-200 px-3 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-60 dark:border-amber-400/30 dark:text-amber-200 dark:hover:bg-amber-500/10"
        >
          <HelpCircle size={15} />
          ขอข้อมูลเพิ่ม
        </button>
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => review("reject")}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-400/30 dark:text-red-200 dark:hover:bg-red-500/10"
        >
          <XCircle size={15} />
          ปฏิเสธ
        </button>
      </div>
      {error ? <p className="text-xs text-red-600 dark:text-red-300">{error}</p> : null}
      <p className="text-xs text-gray-500 dark:text-slate-400">
        การยืนยันที่นี่เป็นการบันทึกผลตรวจสอบสลิปเท่านั้น ไม่ใช่การออกใบเสร็จหรือปิดบัญชีลูกหนี้อัตโนมัติ
      </p>
    </div>
  );
}
