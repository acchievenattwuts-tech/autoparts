"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendClaimToSupplier, closeClaim, cancelClaimAction, reopenClaim } from "../actions";
import CancelDocButton from "@/components/shared/CancelDocButton";

interface Props {
  claimId:       string;
  claimNo:       string;
  currentStatus: string;
}

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5";

const ClaimStatusActions = ({ claimId, claimNo, currentStatus }: Props) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [sentDate, setSentDate]       = useState(new Date().toISOString().slice(0, 10));
  const [resolvedDate, setResolvedDate] = useState(new Date().toISOString().slice(0, 10));
  const [outcome, setOutcome]         = useState<"RECEIVED" | "NO_RESOLUTION">("RECEIVED");
  const [closeNote, setCloseNote]     = useState("");

  const handleSend = () => {
    setError("");
    startTransition(async () => {
      const res = await sendClaimToSupplier(claimId, sentDate);
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  const handleClose = () => {
    setError("");
    startTransition(async () => {
      const res = await closeClaim(claimId, outcome, resolvedDate, closeNote);
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  };


  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-5">
      <h2 className="font-kanit text-base font-semibold text-[#1e3a5f] pb-3 border-b border-gray-100">
        อัปเดตสถานะ
      </h2>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg">{error}</div>
      )}

      {currentStatus === "DRAFT" && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">ส่งสินค้าไปซัพพลายเออร์</h3>
          <div>
            <label className={labelCls}>วันที่ส่ง</label>
            <input
              type="date"
              value={sentDate}
              onChange={(e) => setSentDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={isPending}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {isPending ? "กำลังบันทึก..." : "ยืนยันส่งซัพพลายเออร์"}
          </button>
          <p className="text-xs text-gray-400">Stock จะลด 1 ชิ้น (ส่งออกไปซัพพลายเออร์)</p>
        </div>
      )}

      {currentStatus === "CLOSED" && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">ย้อนกลับสถานะ</h3>
          <button
            onClick={() => {
              if (!confirm("ย้อนกลับเป็นสถานะ [ส่งซัพพลายเออร์แล้ว]?\nถ้าเคยบันทึกรับสินค้าคืน Stock จะถูกคำนวณใหม่")) return;
              setError("");
              startTransition(async () => {
                const res = await reopenClaim(claimId);
                if (res.error) { setError(res.error); return; }
                router.refresh();
              });
            }}
            disabled={isPending}
            className="w-full px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 border border-amber-200"
          >
            {isPending ? "กำลังดำเนินการ..." : "ย้อนกลับเป็น ส่งซัพพลายเออร์แล้ว"}
          </button>
        </div>
      )}

      {currentStatus !== "CANCELLED" && (
        <div className="pt-2 border-t border-gray-100 flex justify-center">
          <CancelDocButton
            docId={claimId}
            docNo={claimNo}
            idFieldName="claimId"
            cancelAction={cancelClaimAction}
            onSuccess={() => router.push("/admin/warranty-claims")}
          />
        </div>
      )}

      {currentStatus === "SENT_TO_SUPPLIER" && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">ปิดเคลม</h3>
          <div>
            <label className={labelCls}>วันที่ได้รับผล</label>
            <input
              type="date"
              value={resolvedDate}
              onChange={(e) => setResolvedDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>ผลลัพธ์</label>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as "RECEIVED" | "NO_RESOLUTION")}
              className={`${inputCls} bg-white`}
            >
              <option value="RECEIVED">ได้รับสินค้าคืน (+1 stock)</option>
              <option value="NO_RESOLUTION">ไม่ได้รับการแก้ไข</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>หมายเหตุ</label>
            <input
              type="text"
              value={closeNote}
              onChange={(e) => setCloseNote(e.target.value)}
              maxLength={500}
              placeholder="หมายเหตุ (ถ้ามี)"
              className={inputCls}
            />
          </div>
          <button
            onClick={handleClose}
            disabled={isPending}
            className="w-full px-4 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {isPending ? "กำลังบันทึก..." : "ปิดเคลม"}
          </button>
          {outcome === "RECEIVED" && (
            <p className="text-xs text-gray-400">Stock จะเพิ่ม 1 ชิ้น (ได้รับสินค้าคืน)</p>
          )}
        </div>
      )}
    </div>
  );
};

export default ClaimStatusActions;
