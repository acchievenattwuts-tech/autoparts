"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import DocumentMutationBlockedNotice from "@/components/shared/DocumentMutationBlockedNotice";
import { PeriodLockNotice, PeriodLockReasonField } from "@/app/admin/_components/PeriodLockControls";
import {
  isPeriodLockReasonLongEnough,
  PERIOD_LOCK_REASON_REQUIRED_MESSAGE,
  type PeriodLockView,
} from "@/lib/period-lock-view";
import { getThailandDateKey } from "@/lib/th-date";
import CancelClaimButton from "../CancelClaimButton";
import {
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
  /** Forward steps (send / close / return to customer) — the "update" guard. */
  mutationBlockedReason?: string | null;
  mutationBlockReferences?: Array<{ href: string; label: string }>;
  /** Reopen and cancel reverse stock rows — the "cancel" guard (adds the supplier DN boundary). */
  reverseBlockedReason?: string | null;
  reverseBlockReferences?: Array<{ href: string; label: string }>;
  /** Claim on a sale warranty: cancelling deletes it and returns to the claims list. */
  deletesClaimOnCancel: boolean;
  /** A posting month of the claim was already distributed: cancel reverses them all. */
  cancelPeriodLock?: PeriodLockView | null;
  /** The month of the step reopen reverses (close / return to customer) was distributed. */
  reopenPeriodLock?: PeriodLockView | null;
}

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm bg-white dark:border-white/20 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:ring-sky-400/50";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5 dark:text-slate-300";

const ClaimStatusActions = ({
  claimId,
  claimNo,
  currentStatus,
  claimType,
  outcome,
  isLotControl,
  mutationBlockedReason,
  mutationBlockReferences = [],
  reverseBlockedReason,
  reverseBlockReferences = [],
  deletesClaimOnCancel,
  cancelPeriodLock = null,
  reopenPeriodLock = null,
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
  const [reopenLockReason, setReopenLockReason] = useState("");

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
    if (reopenPeriodLock?.canOverride && !isPeriodLockReasonLongEnough(reopenLockReason)) {
      setError(PERIOD_LOCK_REASON_REQUIRED_MESSAGE);
      return;
    }
    if (!confirm(message)) return;

    setError("");
    startTransition(async () => {
      const res = await reopenClaim(claimId, reopenLockReason.trim() || undefined);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const isMutationBlocked = Boolean(mutationBlockedReason);
  const reverseReason = reverseBlockedReason ?? mutationBlockedReason ?? null;
  const isReverseBlocked = Boolean(reverseReason);
  // Reopen in a distributed month: blocked unless the admin can unlock it with a reason.
  const isReopenPeriodLocked = Boolean(reopenPeriodLock && !reopenPeriodLock.canOverride);
  // Shown only when it adds something to the forward-step notice above it.
  const reverseOnlyReason = reverseReason && reverseReason !== mutationBlockedReason ? reverseReason : null;
  const canReturnToCustomer =
    currentStatus === "CLOSED" && claimType === "CUSTOMER_WAIT" && outcome === "RECEIVED";

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-5 dark:border-white/10 dark:bg-slate-950/80">
      <h2 className="font-kanit text-base font-semibold text-[#1e3a5f] pb-3 border-b border-gray-100 dark:border-white/10 dark:text-sky-300">
        อัปเดตสถานะ
      </h2>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">{error}</div>
      )}

      {mutationBlockedReason && (
        <DocumentMutationBlockedNotice
          message={mutationBlockedReason}
          references={mutationBlockReferences}
          compact
        />
      )}

      {reverseOnlyReason && (
        <DocumentMutationBlockedNotice
          message={`ย้อนกลับสถานะ / ยกเลิกใบเคลม: ${reverseOnlyReason}`}
          references={reverseBlockReferences}
          compact
        />
      )}

      <PeriodLockNotice lock={cancelPeriodLock ?? reopenPeriodLock} compact />

      {currentStatus === "DRAFT" && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-200">ส่งสินค้าไปซัพพลายเออร์</h3>
          <div>
            <label className={labelCls}>วันที่ส่ง</label>
            <input type="date" value={sentDate} onChange={(e) => setSentDate(e.target.value)} className={inputCls} />
          </div>
          <button
            onClick={handleSend}
            disabled={isPending || isMutationBlocked}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-400"
          >
            {isPending ? "กำลังบันทึก..." : "ยืนยันส่งซัพพลายเออร์"}
          </button>
          <p className="text-xs text-gray-400 dark:text-slate-500">Stock จะลด 1 ชิ้นเมื่อส่งของเคลมออกไป</p>
        </div>
      )}

      {currentStatus === "SENT_TO_SUPPLIER" && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-200">ปิดเคลม</h3>
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
                  Lot ที่รับกลับ <span className="text-red-500 dark:text-rose-400">*</span>
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
                <p className="mt-1 text-xs text-red-500 dark:text-rose-400">สินค้าที่ควบคุม Lot ต้องระบุ Lot ตอนปิดเคลม</p>
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
            disabled={isPending || isMutationBlocked}
            className="w-full px-4 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 dark:bg-sky-600 dark:hover:bg-sky-500"
          >
            {isPending ? "กำลังบันทึก..." : "ปิดเคลม"}
          </button>
          {closeOutcome === "RECEIVED" && (
            <p className="text-xs text-gray-400 dark:text-slate-500">
              ปิดเคลมจะรับของกลับเข้า Stock ก่อน กรณีลูกค้ารอเคลมจะยังไม่ตัด Stock จนกว่าจะอัปเดตสถานะส่งคืนลูกค้า
            </p>
          )}
        </div>
      )}

      {canReturnToCustomer && (
        <div className="space-y-3 border-t border-gray-100 pt-5 dark:border-white/10">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-200">ส่งคืนลูกค้า</h3>
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
            disabled={isPending || isMutationBlocked}
            className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-400"
          >
            {isPending ? "กำลังบันทึก..." : "ยืนยันส่งคืนลูกค้า"}
          </button>
          <p className="text-xs text-gray-400 dark:text-slate-500">ระบบจะตัด Stock 1 ชิ้นเมื่ออัปเดตสถานะนี้</p>
        </div>
      )}

      {currentStatus === "CLOSED" && (
        <div className="space-y-3 border-t border-gray-100 pt-5 dark:border-white/10">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-200">ย้อนกลับสถานะ</h3>
          <PeriodLockReasonField lock={reopenPeriodLock} value={reopenLockReason} onChange={setReopenLockReason} />
          <button
            onClick={() =>
              handleReopen(
                "ย้อนกลับเป็นสถานะ [ส่งซัพพลายเออร์แล้ว] ? หากเคยรับสินค้ากลับแล้ว ระบบจะย้อน Stock และ Lot ของการปิดเคลมให้",
              )
            }
            disabled={isPending || isReverseBlocked || isReopenPeriodLocked}
            title={isReopenPeriodLocked ? reopenPeriodLock?.message : undefined}
            className="w-full px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 border border-amber-200 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-200 dark:hover:bg-amber-400/20"
          >
            {isPending ? "กำลังดำเนินการ..." : "ย้อนกลับเป็น ส่งซัพพลายเออร์แล้ว"}
          </button>
        </div>
      )}

      {currentStatus === "RETURNED_TO_CUSTOMER" && (
        <div className="space-y-3 border-t border-gray-100 pt-5 dark:border-white/10">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-200">ย้อนกลับสถานะ</h3>
          <PeriodLockReasonField lock={reopenPeriodLock} value={reopenLockReason} onChange={setReopenLockReason} />
          <button
            onClick={() =>
              handleReopen("ย้อนกลับเป็นสถานะ [ปิดเคลม] ? ระบบจะคืน Stock และ Lot ของการส่งคืนลูกค้าให้")
            }
            disabled={isPending || isReverseBlocked || isReopenPeriodLocked}
            title={isReopenPeriodLocked ? reopenPeriodLock?.message : undefined}
            className="w-full px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 border border-amber-200 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-200 dark:hover:bg-amber-400/20"
          >
            {isPending ? "กำลังดำเนินการ..." : "ย้อนกลับเป็น ปิดเคลม"}
          </button>
        </div>
      )}

      {currentStatus !== "CANCELLED" && (
        <div className="pt-2 border-t border-gray-100 flex justify-center dark:border-white/10">
          <CancelClaimButton
            claimId={claimId}
            claimNo={claimNo}
            deletesClaim={deletesClaimOnCancel}
            disabledReason={reverseReason}
            periodLock={cancelPeriodLock}
          />
        </div>
      )}
    </div>
  );
};

export default ClaimStatusActions;
