"use client";

import { useState, useTransition } from "react";
import { XCircle } from "lucide-react";

interface CancelDocButtonProps {
  docId:      string;
  docNo:      string;
  idFieldName: string;   // เช่น "saleId", "purchaseId", "adjustmentId"
  cancelAction: (formData: FormData) => Promise<{ success?: boolean; error?: string }>;
  onSuccess?:  () => void;
}

const CancelDocButton = ({ docId, docNo, idFieldName, cancelAction, onSuccess }: CancelDocButtonProps) => {
  const [isPending, startTransition] = useTransition();
  const [showModal, setShowModal]    = useState(false);
  const [cancelNote, setCancelNote]  = useState("");
  const [error, setError]            = useState("");

  const handleConfirm = () => {
    setError("");
    const formData = new FormData();
    formData.set(idFieldName, docId);
    if (cancelNote.trim()) formData.set("cancelNote", cancelNote.trim());

    startTransition(async () => {
      const result = await cancelAction(formData);
      if (result.error) {
        setError(result.error);
      } else {
        setShowModal(false);
        setCancelNote("");
        onSuccess?.();
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setShowModal(true); setError(""); }}
        className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700 transition-colors"
        title="ยกเลิกเอกสาร"
      >
        <XCircle size={14} /> ยกเลิก
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-[#0f1e33] dark:ring-1 dark:ring-white/10">
            <h3 className="mb-2 font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">
              ยืนยันการยกเลิกเอกสาร {docNo}
            </h3>
            <p className="mb-4 text-sm text-gray-500 dark:text-slate-400">
              เอกสาร <span className="font-mono font-semibold text-gray-700 dark:text-slate-200">{docNo}</span> จะถูกยกเลิก
              ระบบจะคำนวณสต็อก MAVG ใหม่ทันที และไม่สามารถกู้คืนได้
            </p>

            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-slate-300">
                หมายเหตุการยกเลิก (ถ้ามี)
              </label>
              <input
                type="text"
                value={cancelNote}
                onChange={(e) => setCancelNote(e.target.value)}
                maxLength={200}
                placeholder="ระบุเหตุผลการยกเลิก..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 dark:border-white/15 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:ring-red-500/40"
              />
            </div>

            {error && (
              <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setShowModal(false); setCancelNote(""); setError(""); }}
                disabled={isPending}
                className="px-4 py-2 text-sm text-gray-600 transition-colors hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-100"
              >
                ปิด
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isPending}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-60 dark:bg-red-600 dark:hover:bg-red-700"
              >
                {isPending ? "กำลังยกเลิก..." : "ยืนยันยกเลิก"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default CancelDocButton;
