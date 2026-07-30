"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Truck, CheckCircle, RotateCcw, Save, UserRound } from "lucide-react";
import { updateShippingStatus } from "../sales/actions";
import { SHIPPING_METHOD_OPTIONS } from "@/lib/shipping";
import type { SelectOption } from "@/components/shared/SearchableSelect";
import DeliveryStaffDialog from "./DeliveryStaffDialog";

interface Props {
  saleId: string;
  saleNo: string;
  currentStatus: string;
  currentTrackingNo: string | null;
  currentShippingMethod: string;
  currentDeliveryStaffId: string | null;
  staffOptions: SelectOption[];
}

type StaffDialogMode = "deliver" | "edit";

const PREV_STATUS: Record<string, string> = {
  OUT_FOR_DELIVERY: "PENDING",
  DELIVERED:        "OUT_FOR_DELIVERY",
};

const DeliveryUpdateButton = ({
  saleId,
  saleNo,
  currentStatus,
  currentTrackingNo,
  currentShippingMethod,
  currentDeliveryStaffId,
  staffOptions,
}: Props) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [trackingNo, setTrackingNo]       = useState(currentTrackingNo ?? "");
  const [shippingMethod, setShippingMethod] = useState(currentShippingMethod);
  const [error, setError]                 = useState("");
  const [staffDialogMode, setStaffDialogMode] = useState<StaffDialogMode | null>(null);
  const [staffDialogError, setStaffDialogError] = useState("");

  const requiresTracking = shippingMethod !== "NONE" && shippingMethod !== "SELF";

  const handleSave = () => {
    setError("");
    startTransition(async () => {
      const result = await updateShippingStatus(saleId, {
        shippingStatus: currentStatus,
        trackingNo:     trackingNo.trim(),
        shippingMethod,
      });
      if (result?.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  const handleUpdateStatus = (newStatus: string) => {
    if (requiresTracking && !trackingNo.trim()) {
      setError("กรุณากรอกเลข Tracking ก่อนอัปเดตสถานะ");
      return;
    }
    setError("");
    startTransition(async () => {
      const result = await updateShippingStatus(saleId, {
        shippingStatus: newStatus,
        trackingNo:     trackingNo.trim(),
        shippingMethod,
      });
      if (result?.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  const handleOpenDeliverDialog = () => {
    if (requiresTracking && !trackingNo.trim()) {
      setError("กรุณากรอกเลข Tracking ก่อนอัปเดตสถานะ");
      return;
    }
    setError("");
    setStaffDialogError("");
    setStaffDialogMode("deliver");
  };

  const handleConfirmStaff = (staffId: string) => {
    if (!staffId) {
      setStaffDialogError("กรุณาเลือกผู้ส่งก่อนยืนยัน");
      return;
    }
    setStaffDialogError("");
    startTransition(async () => {
      const result = await updateShippingStatus(saleId, {
        shippingStatus:  staffDialogMode === "edit" ? currentStatus : "DELIVERED",
        trackingNo:      trackingNo.trim(),
        shippingMethod,
        deliveryStaffId: staffId,
      });
      if (result?.error) {
        setStaffDialogError(result.error);
        return;
      }
      setStaffDialogMode(null);
      router.refresh();
    });
  };

  const handleRevert = () => {
    const prev = PREV_STATUS[currentStatus];
    if (!prev) return;
    setError("");
    startTransition(async () => {
      const result = await updateShippingStatus(saleId, {
        shippingStatus: prev,
        trackingNo:     trackingNo.trim(),
        shippingMethod,
      });
      if (result?.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-1.5 min-w-[200px]">
      {/* Method + Tracking */}
      <div className="flex gap-1.5 flex-wrap">
        <select
          value={shippingMethod}
          onChange={(e) => { setShippingMethod(e.target.value); setError(""); }}
          className="rounded border border-gray-300 bg-white px-1.5 py-1 text-xs dark:border-white/15 dark:bg-slate-800 dark:text-slate-100"
        >
          {Object.entries(SHIPPING_METHOD_OPTIONS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <input
          type="text"
          value={trackingNo}
          onChange={(e) => { setTrackingNo(e.target.value); setError(""); }}
          placeholder={requiresTracking ? "เลข Tracking *" : "เลข Tracking"}
          className={`w-32 rounded border px-2 py-1 text-xs dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 ${
            error ? "border-red-400 bg-red-50 dark:border-rose-400/60 dark:bg-rose-500/10" : "border-gray-300 dark:border-white/15"
          }`}
        />
        <button
          onClick={handleSave}
          disabled={isPending}
          title="บันทึกข้อมูลขนส่ง"
          className="inline-flex items-center gap-1 rounded border border-gray-300 bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:border-white/15 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/15"
        >
          <Save size={11} /> บันทึก
        </button>
      </div>

      {/* Status buttons */}
      <div className="flex gap-1.5 flex-wrap">
        {currentStatus === "PENDING" && (
          <button
            onClick={() => handleUpdateStatus("OUT_FOR_DELIVERY")}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-sky-600 dark:hover:bg-sky-700"
          >
            <Truck size={11} /> ออกส่ง
          </button>
        )}
        {currentStatus !== "DELIVERED" && (
          <button
            onClick={handleOpenDeliverDialog}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-700"
          >
            <CheckCircle size={11} /> ส่งแล้ว
          </button>
        )}
        {currentStatus === "DELIVERED" && (
          <button
            onClick={() => {
              setError("");
              setStaffDialogError("");
              setStaffDialogMode("edit");
            }}
            disabled={isPending}
            title="แก้ไขผู้ส่งของบิลนี้"
            className="inline-flex items-center gap-1 rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-200 dark:hover:bg-sky-500/20"
          >
            <UserRound size={11} /> แก้ผู้ส่ง
          </button>
        )}
        {PREV_STATUS[currentStatus] && (
          <button
            onClick={handleRevert}
            disabled={isPending}
            title={`ย้อนกลับเป็น "${currentStatus === "DELIVERED" ? "กำลังส่ง" : "รอจัดส่ง"}"`}
            className="inline-flex items-center gap-1 rounded border border-yellow-300 bg-yellow-100 px-2 py-1 text-xs text-yellow-800 hover:bg-yellow-200 disabled:opacity-50 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
          >
            <RotateCcw size={11} /> ย้อนกลับ
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-500 dark:text-rose-400">{error}</p>}

      {staffDialogMode !== null && (
        <DeliveryStaffDialog
          title={staffDialogMode === "edit" ? "แก้ไขผู้ส่ง" : "ยืนยันการส่งสำเร็จ"}
          description={
            staffDialogMode === "edit"
              ? "เลือกผู้ส่งที่ถูกต้องสำหรับบิลนี้ แล้วกดบันทึก"
              : "เลือกผู้ส่งของบิลนี้ก่อนอัปเดตสถานะเป็น “ส่งแล้ว”"
          }
          confirmLabel={staffDialogMode === "edit" ? "บันทึกผู้ส่ง" : "ยืนยันส่งแล้ว"}
          saleNo={saleNo}
          staffOptions={staffOptions}
          initialStaffId={currentDeliveryStaffId}
          isPending={isPending}
          error={staffDialogError}
          onClose={() => {
            if (isPending) return;
            setStaffDialogMode(null);
            setStaffDialogError("");
          }}
          onConfirm={handleConfirmStaff}
        />
      )}
    </div>
  );
};

export default DeliveryUpdateButton;
