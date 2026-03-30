"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

const SalesFilterBar = () => {
  const router      = useRouter();
  const pathname    = usePathname();
  const searchParams = useSearchParams();

  const current            = searchParams.get("paymentType") ?? "ALL";
  const currentShip        = searchParams.get("shippingStatus") ?? "";
  const currentFulfillment = searchParams.get("fulfillmentType") ?? "";

  const setFilter = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "ALL") {
      params.delete("paymentType");
    } else {
      params.set("paymentType", value);
    }
    // Clear shippingStatus when switching payment filter
    params.delete("shippingStatus");
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  };

  const setDeliveryFilter = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("fulfillmentType", "DELIVERY");
    params.set("shippingStatus", "PENDING");
    params.delete("paymentType");
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  };

  const options = [
    { value: "ALL",         label: "ทั้งหมด" },
    { value: "CASH_SALE",   label: "ขายสด (SA)" },
    { value: "CREDIT_SALE", label: "ขายเชื่อ (SAC)" },
  ];

  const isDeliveryFilter = currentFulfillment === "DELIVERY" && currentShip === "PENDING";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm text-gray-500">กรอง:</span>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setFilter(opt.value)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
            !isDeliveryFilter && current === opt.value
              ? "bg-[#1e3a5f] text-white border-[#1e3a5f]"
              : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
          }`}
        >
          {opt.label}
        </button>
      ))}
      <button
        onClick={setDeliveryFilter}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
          isDeliveryFilter
            ? "bg-purple-600 text-white border-purple-600"
            : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
        }`}
      >
        รอจัดส่ง
      </button>
    </div>
  );
};

export default SalesFilterBar;
