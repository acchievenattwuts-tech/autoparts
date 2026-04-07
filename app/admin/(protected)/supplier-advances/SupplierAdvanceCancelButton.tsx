"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { XCircle } from "lucide-react";
import { cancelSupplierAdvance } from "./actions";

const SupplierAdvanceCancelButton = ({
  advanceId,
  docNo,
}: {
  advanceId: string;
  docNo: string;
}) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showModal, setShowModal] = useState(false);
  const [cancelNote, setCancelNote] = useState("");
  const [error, setError] = useState("");

  const handleConfirm = () => {
    setError("");

    const formData = new FormData();
    formData.set("advanceId", advanceId);
    if (cancelNote.trim()) {
      formData.set("cancelNote", cancelNote.trim());
    }

    startTransition(async () => {
      const result = await cancelSupplierAdvance(formData);
      if (result.error) {
        setError(result.error);
        return;
      }

      setShowModal(false);
      setCancelNote("");
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setShowModal(true);
          setError("");
        }}
        className="inline-flex items-center gap-1 text-xs text-red-500 transition-colors hover:text-red-700"
        title="ยกเลิกเอกสาร"
      >
        <XCircle size={14} /> ยกเลิก
      </button>

      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-2 font-kanit text-lg font-semibold text-gray-900">
              ยืนยันการยกเลิกเอกสาร {docNo}
            </h3>
            <p className="mb-4 text-sm text-gray-500">
              เมื่อยกเลิกเอกสารนี้ ระบบจะลบรายการเงินออกที่ผูกกับเอกสารมัดจำ และจะไม่สามารถนำยอดนี้ไปใช้หักในเอกสารจ่ายชำระได้อีก
            </p>

            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                หมายเหตุการยกเลิก (ถ้ามี)
              </label>
              <input
                type="text"
                value={cancelNote}
                onChange={(event) => setCancelNote(event.target.value)}
                maxLength={200}
                placeholder="ระบุเหตุผลการยกเลิก..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
              />
            </div>

            {error ? (
              <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  setCancelNote("");
                  setError("");
                }}
                disabled={isPending}
                className="px-4 py-2 text-sm text-gray-600 transition-colors hover:text-gray-900"
              >
                ปิด
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isPending}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-60"
              >
                {isPending ? "กำลังยกเลิก..." : "ยืนยันยกเลิก"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default SupplierAdvanceCancelButton;
