"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import CancelDocButton from "@/components/shared/CancelDocButton";
import { getThailandDateKey } from "@/lib/th-date";
import {
  cancelClaimAction,
  closeClaim,
  reopenClaim,
  returnClaimToCustomer,
  sendClaimToSupplier,
} from "../actions";

interface Props {
  claimId: string;
  claimNo: string;
  currentStatus: string;
  claimType: string;
  outcome: string | null;
  isLotControl: boolean;
}

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm bg-white";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5";

const ClaimStatusActions = ({
  claimId,
  claimNo,
  currentStatus,
  claimType,
  outcome,
  isLotControl,
}: Props) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [sentDate, setSentDate] = useState(getThailandDateKey());
  const [resolvedDate, setResolvedDate] = useState(getThailandDateKey());
  const [returnedDate, setReturnedDate] = useState(getThailandDateKey());
  const [closeOutcome, setCloseOutcome] = useState<"RECEIVED" | "NO_RESOLUTION">("RECEIVED");
  const [closeNote, setCloseNote] = useState("");
  const [receivedLotNo, setReceivedLotNo] = useState("");
  const [receivedMfgDate, setReceivedMfgDate] = useState("");
  const [receivedExpDate, setReceivedExpDate] = useState("");

  const handleSend = () => {
    setError("");
    startTransition(async () => {
      const res = await sendClaimToSupplier(claimId, sentDate);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const handleClose = () => {
    setError("");
    if (closeOutcome === "RECEIVED" && isLotControl && !receivedLotNo.trim()) {
      setError("กรุณาระบุ Lot ที่รับกลับจากซัพพลายเออร์");
      return;
    }

    startTransition(async () => {
      const res = await closeClaim(
        claimId,
        closeOutcome,
        resolvedDate,
        closeNote,
        receivedLotNo,
        receivedMfgDate,
        receivedExpDate,
      );
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const handleReturnToCustomer = () => {
    setError("");
    startTransition(async () => {
      const res = await returnClaimToCustomer(claimId, returnedDate);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const handleReopen = (message: string) => {
    if (!confirm(message)) return;

    setError("");
    startTransition(async () => {
      const res = await reopenClaim(claimId);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const canReturnToCustomer =
    currentStatus === "CLOSED" && claimType === "CUSTOMER_WAIT" && outcome === "RECEIVED";

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
            <input type="date" value={sentDate} onChange={(e) => setSentDate(e.target.value)} className={inputCls} />
          </div>
          <button
            onClick={handleSend}
            disabled={isPending}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {isPending ? "กำลังบันทึก..." : "ยืนยันส่งซัพพลายเออร์"}
          </button>
          <p className="text-xs text-gray-400">Stock จะลด 1 ชิ้นเมื่อส่งของเคลมออกไป</p>
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
              value={closeOutcome}
              onChange={(e) => setCloseOutcome(e.target.value as "RECEIVED" | "NO_RESOLUTION")}
              className={inputCls}
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
          {closeOutcome === "RECEIVED" && isLotControl && (
            <>
              <div>
                <label className={labelCls}>
                  Lot ที่รับกลับ <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={receivedLotNo}
                  onChange={(e) => setReceivedLotNo(e.target.value)}
                  maxLength={100}
                  placeholder="ระบุ Lot No"
                  className={inputCls}
                  aria-required="true"
                />
                <p className="mt-1 text-xs text-red-500">สินค้าที่ควบคุม Lot ต้องระบุ Lot ตอนปิดเคลม</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>วันที่ผลิต</label>
                  <input
                    type="date"
                    value={receivedMfgDate}
                    onChange={(e) => setReceivedMfgDate(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>วันหมดอายุ</label>
                  <input
                    type="date"
                    value={receivedExpDate}
                    onChange={(e) => setReceivedExpDate(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
            </>
          )}
          <button
            onClick={handleClose}
            disabled={isPending}
            className="w-full px-4 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {isPending ? "กำลังบันทึก..." : "ปิดเคลม"}
          </button>
          {closeOutcome === "RECEIVED" && (
            <p className="text-xs text-gray-400">
              ปิดเคลมจะรับของกลับเข้า Stock ก่อน กรณีลูกค้ารอเคลมจะยังไม่ตัด Stock จนกว่าจะอัปเดตสถานะส่งคืนลูกค้า
            </p>
          )}
        </div>
      )}

      {canReturnToCustomer && (
        <div className="space-y-3 border-t border-gray-100 pt-5">
          <h3 className="text-sm font-semibold text-gray-700">ส่งคืนลูกค้า</h3>
          <div>
            <label className={labelCls}>วันที่ส่งคืนลูกค้า</label>
            <input
              type="date"
              value={returnedDate}
              onChange={(e) => setReturnedDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <button
            onClick={handleReturnToCustomer}
            disabled={isPending}
            className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {isPending ? "กำลังบันทึก..." : "ยืนยันส่งคืนลูกค้า"}
          </button>
          <p className="text-xs text-gray-400">ระบบจะตัด Stock 1 ชิ้นเมื่ออัปเดตสถานะนี้</p>
        </div>
      )}

      {currentStatus === "CLOSED" && (
        <div className="space-y-3 border-t border-gray-100 pt-5">
          <h3 className="text-sm font-semibold text-gray-700">ย้อนกลับสถานะ</h3>
          <button
            onClick={() =>
              handleReopen(
                "ย้อนกลับเป็นสถานะ [ส่งซัพพลายเออร์แล้ว] ? หากเคยรับสินค้ากลับแล้ว ระบบจะย้อน Stock และ Lot ของการปิดเคลมให้",
              )
            }
            disabled={isPending}
            className="w-full px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 border border-amber-200"
          >
            {isPending ? "กำลังดำเนินการ..." : "ย้อนกลับเป็น ส่งซัพพลายเออร์แล้ว"}
          </button>
        </div>
      )}

      {currentStatus === "RETURNED_TO_CUSTOMER" && (
        <div className="space-y-3 border-t border-gray-100 pt-5">
          <h3 className="text-sm font-semibold text-gray-700">ย้อนกลับสถานะ</h3>
          <button
            onClick={() =>
              handleReopen("ย้อนกลับเป็นสถานะ [ปิดเคลม] ? ระบบจะคืน Stock และ Lot ของการส่งคืนลูกค้าให้")
            }
            disabled={isPending}
            className="w-full px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 border border-amber-200"
          >
            {isPending ? "กำลังดำเนินการ..." : "ย้อนกลับเป็น ปิดเคลม"}
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
    </div>
  );
};

export default ClaimStatusActions;
