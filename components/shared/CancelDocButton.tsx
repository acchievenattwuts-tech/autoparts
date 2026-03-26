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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="font-kanit text-lg font-semibold text-gray-900 mb-2">
              ยืนยันการยกเลิกเอกสาร {docNo}
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              เอกสาร <span className="font-mono font-semibold text-gray-700">{docNo}</span> จะถูกยกเลิก
              ระบบจะ re-calculate Stock MAVG ทันที และไม่สามารถกู้คืนได้
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                หมายเหตุการยกเลิก (ถ้ามี)
              </label>
              <input
                type="text"
                value={cancelNote}
                onChange={(e) => setCancelNote(e.target.value)}
                maxLength={200}
                placeholder="ระบุเหตุผลการยกเลิก..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setShowModal(false); setCancelNote(""); setError(""); }}
                disabled={isPending}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                ปิด
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isPending}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
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
