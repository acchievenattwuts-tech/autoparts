"use client";

import { useState, useTransition } from "react";
import { Ban, Loader2 } from "lucide-react";
import { cancelSupplierPayment } from "./actions";

const SupplierPaymentCancelButton = ({
  paymentId,
  docNo,
}: {
  paymentId: string;
  docNo: string;
}) => {
  const [open, setOpen] = useState(false);
  const [cancelNote, setCancelNote] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleConfirm = () => {
    setError("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("paymentId", paymentId);
      formData.set("cancelNote", cancelNote);
      const result = await cancelSupplierPayment(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      window.location.reload();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-red-600 transition-colors hover:text-red-700"
      >
        <Ban size={14} /> ยกเลิก
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="font-kanit text-lg font-semibold text-gray-900">ยืนยันการยกเลิกเอกสาร</h3>
            <p className="mt-2 text-sm text-gray-600">
              เอกสาร <span className="font-mono font-medium text-[#1e3a5f]">{docNo}</span>{" "}
              จะถูกยกเลิกและระบบจะคืนยอดคงเหลือให้เอกสารที่เกี่ยวข้องอัตโนมัติ
            </p>

            <div className="mt-4">
              <label className="mb-1.5 block text-sm font-medium text-gray-700">หมายเหตุยกเลิก</label>
              <textarea
                value={cancelNote}
                onChange={(event) => setCancelNote(event.target.value)}
                rows={3}
                maxLength={200}
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                placeholder="ระบุเหตุผลในการยกเลิก (ถ้ามี)"
              />
            </div>

            {error ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isPending}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                ปิด
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPending ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
                ยืนยันยกเลิก
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default SupplierPaymentCancelButton;
