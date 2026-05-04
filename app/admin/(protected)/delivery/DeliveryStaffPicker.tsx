"use client";

type DeliveryStaffPickerProps = {
  shippingStatus: "PENDING" | "OUT_FOR_DELIVERY" | "DELIVERED";
  deliveryStaffName?: string | null;
  deliveryStaffEmail?: string | null;
  compact?: boolean;
};

const DeliveryStaffPicker = ({
  shippingStatus,
  deliveryStaffName,
  deliveryStaffEmail,
  compact = false,
}: DeliveryStaffPickerProps) => {
  const displayText = deliveryStaffName
    ? deliveryStaffName
    : shippingStatus === "DELIVERED"
      ? "ยังไม่ได้บันทึกผู้ส่ง"
      : "บันทึกอัตโนมัติเมื่อส่งแล้ว";

  return (
    <div className={compact ? "space-y-1" : "min-w-[180px] space-y-1"}>
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:border-white/10 dark:bg-slate-950 dark:text-slate-200">
        <p className="truncate font-medium">{displayText}</p>
        <p className="truncate text-xs text-gray-400 dark:text-slate-500">
          {deliveryStaffEmail ?? "แก้ไขเองไม่ได้"}
        </p>
      </div>
    </div>
  );
};

export default DeliveryStaffPicker;
