"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, LoaderCircle, XCircle } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Props = {
  slipId: string;
  /** Automatic-check warnings; confirming a flagged slip asks once more (UX only). */
  warnings?: string[];
};

type Decision = "confirm" | "reject" | "needs_info";

const DECISION_LABELS: Record<Decision, { idle: string; pending: string }> = {
  confirm: {
    idle: "ยืนยันผลตรวจสลิป",
    pending: "กำลังยืนยัน...",
  },
  needs_info: {
    idle: "ขอข้อมูลเพิ่ม",
    pending: "กำลังบันทึก...",
  },
  reject: {
    idle: "ปฏิเสธ",
    pending: "กำลังปฏิเสธ...",
  },
};

export default function AdminPaymentSlipReviewActions({ slipId, warnings = [] }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flaggedConfirmOpen, setFlaggedConfirmOpen] = useState(false);

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

  const handleConfirmClick = () => {
    if (warnings.length > 0) {
      setFlaggedConfirmOpen(true);
      return;
    }
    void review("confirm");
  };

  const handleFlaggedConfirm = () => {
    setFlaggedConfirmOpen(false);
    void review("confirm");
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending !== null}
          onClick={handleConfirmClick}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-200 px-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-400/30 dark:text-emerald-200 dark:hover:bg-emerald-500/10"
        >
          {pending === "confirm" ? <LoaderCircle size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
          {pending === "confirm" ? DECISION_LABELS.confirm.pending : DECISION_LABELS.confirm.idle}
        </button>
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => review("needs_info")}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-200 px-3 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-60 dark:border-amber-400/30 dark:text-amber-200 dark:hover:bg-amber-500/10"
        >
          {pending === "needs_info" ? <LoaderCircle size={15} className="animate-spin" /> : <HelpCircle size={15} />}
          {pending === "needs_info" ? DECISION_LABELS.needs_info.pending : DECISION_LABELS.needs_info.idle}
        </button>
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => review("reject")}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-400/30 dark:text-red-200 dark:hover:bg-red-500/10"
        >
          {pending === "reject" ? <LoaderCircle size={15} className="animate-spin" /> : <XCircle size={15} />}
          {pending === "reject" ? DECISION_LABELS.reject.pending : DECISION_LABELS.reject.idle}
        </button>
      </div>
      {error ? <p className="text-xs text-red-600 dark:text-red-300">{error}</p> : null}
      <p className="text-xs text-gray-500 dark:text-slate-400">
        การยืนยันที่นี่เป็นการบันทึกผลตรวจสอบสลิปเท่านั้น ไม่ใช่การออกใบเสร็จหรือปิดบัญชีลูกหนี้อัตโนมัติ
      </p>

      <AlertDialog open={flaggedConfirmOpen} onOpenChange={setFlaggedConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-700 dark:text-red-200">
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-500" />
              สลิปนี้มีคำเตือน ยืนยันต่อหรือไม่?
            </AlertDialogTitle>
            <AlertDialogDescription>
              ตรวจยอดเงินเข้าในแอปธนาคารให้แน่ใจก่อน ระบบจะบันทึกไว้ว่ายืนยันทั้งที่มีคำเตือนนี้
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="space-y-1.5 text-sm">
            {warnings.map((warning) => (
              <li
                key={warning}
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100"
              >
                {warning}
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>กลับไปตรวจสอบ</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleFlaggedConfirm}
              className="bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:text-slate-950 dark:hover:bg-red-400"
            >
              ยืนยันทั้งที่มีคำเตือน
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
