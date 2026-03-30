"use client";

import { useState, useTransition } from "react";
import { Truck, CheckCircle } from "lucide-react";
import { updateShippingStatus } from "../sales/actions";
import { SHIPPING_METHOD_OPTIONS } from "@/lib/shipping";

interface Props {
  saleId: string;
  currentStatus: string;
  currentTrackingNo: string | null;
  currentShippingMethod: string;
}

const DeliveryUpdateButton = ({ saleId, currentStatus, currentTrackingNo, currentShippingMethod }: Props) => {
  const [isPending, startTransition] = useTransition();
  const [trackingNo, setTrackingNo] = useState(currentTrackingNo ?? "");
  const [shippingMethod, setShippingMethod] = useState(currentShippingMethod);

  if (currentStatus === "DELIVERED") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
        <CheckCircle size={14} /> ส่งแล้ว
      </span>
    );
  }

  const handleUpdate = (newStatus: string) => {
    startTransition(async () => {
      await updateShippingStatus(saleId, { shippingStatus: newStatus, trackingNo, shippingMethod });
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <select
          value={shippingMethod}
          onChange={(e) => setShippingMethod(e.target.value)}
          className="text-xs border border-gray-300 rounded px-1.5 py-1 bg-white"
        >
          {Object.entries(SHIPPING_METHOD_OPTIONS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <input
          type="text"
          value={trackingNo}
          onChange={(e) => setTrackingNo(e.target.value)}
          placeholder="เลข Tracking"
          className="text-xs border border-gray-300 rounded px-2 py-1 w-32"
        />
      </div>
      <div className="flex gap-1.5">
        {currentStatus === "PENDING" && (
          <button
            onClick={() => handleUpdate("OUT_FOR_DELIVERY")}
            disabled={isPending}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
          >
            <Truck size={12} /> ออกส่ง
          </button>
        )}
        <button
          onClick={() => handleUpdate("DELIVERED")}
          disabled={isPending}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
        >
          <CheckCircle size={12} /> ส่งแล้ว
        </button>
      </div>
    </div>
  );
};

export default DeliveryUpdateButton;
