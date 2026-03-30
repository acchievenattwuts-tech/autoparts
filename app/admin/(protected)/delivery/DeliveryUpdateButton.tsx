"use client";

import { useState, useTransition } from "react";
import { Truck, CheckCircle, RotateCcw, Save } from "lucide-react";
import { updateShippingStatus } from "../sales/actions";
import { SHIPPING_METHOD_OPTIONS } from "@/lib/shipping";

interface Props {
  saleId: string;
  currentStatus: string;
  currentTrackingNo: string | null;
  currentShippingMethod: string;
}

const PREV_STATUS: Record<string, string> = {
  OUT_FOR_DELIVERY: "PENDING",
  DELIVERED:        "OUT_FOR_DELIVERY",
};

const DeliveryUpdateButton = ({ saleId, currentStatus, currentTrackingNo, currentShippingMethod }: Props) => {
  const [isPending, startTransition] = useTransition();
  const [trackingNo, setTrackingNo]       = useState(currentTrackingNo ?? "");
  const [shippingMethod, setShippingMethod] = useState(currentShippingMethod);
  const [error, setError]                 = useState("");

  const requiresTracking = shippingMethod !== "NONE" && shippingMethod !== "SELF";

  const handleSave = () => {
    setError("");
    startTransition(async () => {
      await updateShippingStatus(saleId, {
        shippingStatus: currentStatus,
        trackingNo:     trackingNo.trim(),
        shippingMethod,
      });
    });
  };

  const handleUpdateStatus = (newStatus: string) => {
    if (requiresTracking && !trackingNo.trim()) {
      setError("กรุณากรอกเลข Tracking ก่อนอัปเดตสถานะ");
      return;
    }
    setError("");
    startTransition(async () => {
      await updateShippingStatus(saleId, {
        shippingStatus: newStatus,
        trackingNo:     trackingNo.trim(),
        shippingMethod,
      });
    });
  };

  const handleRevert = () => {
    const prev = PREV_STATUS[currentStatus];
    if (!prev) return;
    setError("");
    startTransition(async () => {
      await updateShippingStatus(saleId, {
        shippingStatus: prev,
        trackingNo:     trackingNo.trim(),
        shippingMethod,
      });
    });
  };

  return (
    <div className="flex flex-col gap-1.5 min-w-[200px]">
      {/* Method + Tracking */}
      <div className="flex gap-1.5 flex-wrap">
        <select
          value={shippingMethod}
          onChange={(e) => { setShippingMethod(e.target.value); setError(""); }}
          className="text-xs border border-gray-300 rounded px-1.5 py-1 bg-white"
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
          className={`text-xs border rounded px-2 py-1 w-32 ${
            error ? "border-red-400 bg-red-50" : "border-gray-300"
          }`}
        />
        <button
          onClick={handleSave}
          disabled={isPending}
          title="บันทึกข้อมูลขนส่ง"
          className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded border border-gray-300 disabled:opacity-50"
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
            className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
          >
            <Truck size={11} /> ออกส่ง
          </button>
        )}
        {currentStatus !== "DELIVERED" && (
          <button
            onClick={() => handleUpdateStatus("DELIVERED")}
            disabled={isPending}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
          >
            <CheckCircle size={11} /> ส่งแล้ว
          </button>
        )}
        {PREV_STATUS[currentStatus] && (
          <button
            onClick={handleRevert}
            disabled={isPending}
            title={`ย้อนกลับเป็น "${currentStatus === "DELIVERED" ? "กำลังส่ง" : "รอจัดส่ง"}"`}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-yellow-100 hover:bg-yellow-200 text-yellow-800 rounded border border-yellow-300 disabled:opacity-50"
          >
            <RotateCcw size={11} /> ย้อนกลับ
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
};

export default DeliveryUpdateButton;
