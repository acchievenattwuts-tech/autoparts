"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";

const SalesFilterBar = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const current = searchParams.get("paymentType") ?? "ALL";
  const currentShip = searchParams.get("shippingStatus") ?? "";
  const currentFulfillment = searchParams.get("fulfillmentType") ?? "";

  const setFilter = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "ALL") {
      params.delete("paymentType");
    } else {
      params.set("paymentType", value);
    }
    params.delete("shippingStatus");
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const setDeliveryFilter = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("fulfillmentType", "DELIVERY");
    params.set("shippingStatus", "PENDING");
    params.delete("paymentType");
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const options = [
    { value: "ALL", label: "ทั้งหมด" },
    { value: "CASH_SALE", label: "ขายสด (SA)" },
    { value: "CREDIT_SALE", label: "ขายเชื่อ (SAC)" },
  ];

  const isDeliveryFilter = currentFulfillment === "DELIVERY" && currentShip === "PENDING";

  return (
    <div className={`flex flex-wrap items-center gap-2 transition-opacity ${isPending ? "opacity-70" : ""}`}>
      <span className="text-sm text-gray-500">กรอง:</span>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setFilter(opt.value)}
          disabled={isPending}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors disabled:cursor-wait disabled:opacity-80 ${
            !isDeliveryFilter && current === opt.value
              ? "bg-[#1e3a5f] text-white border-[#1e3a5f]"
              : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
          }`}
        >
          {!isDeliveryFilter && current === opt.value && isPending ? <LoaderCircle size={13} className="mr-1 inline animate-spin" /> : null}
          {opt.label}
        </button>
      ))}
      <button
        onClick={setDeliveryFilter}
        disabled={isPending}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors disabled:cursor-wait disabled:opacity-80 ${
          isDeliveryFilter
            ? "bg-purple-600 text-white border-purple-600"
            : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
        }`}
      >
        {isDeliveryFilter && isPending ? <LoaderCircle size={13} className="mr-1 inline animate-spin" /> : null}
        รอจัดส่ง
      </button>
    </div>
  );
};

export default SalesFilterBar;
