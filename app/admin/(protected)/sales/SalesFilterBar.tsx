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
  const currentPaymentStatus = searchParams.get("paymentStatus") ?? "ALL";


  const setFilter = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "ALL") {
      params.delete("paymentType");
    } else {
      params.set("paymentType", value);
    }
    if (value === "CASH_SALE" && params.get("paymentStatus") === "OUTSTANDING") {
      params.delete("paymentStatus");
    }
    params.delete("shippingStatus");
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const setPaymentStatus = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "ALL") params.delete("paymentStatus");
    else params.set("paymentStatus", value);
    if (value === "OUTSTANDING") {
      params.set("paymentType", "CREDIT_SALE");
    }
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
    params.delete("paymentStatus");
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

  const paymentStatusOptions = [
    { value: "ALL", label: "ทุกสถานะ" },
    { value: "PAID", label: "ชำระแล้ว" },
    { value: "OUTSTANDING", label: "ค้างชำระ" },
  ];

  const isDeliveryFilter = currentFulfillment === "DELIVERY" && currentShip === "PENDING";

  return (
    <div className={`flex flex-wrap items-center gap-2 transition-opacity ${isPending ? "opacity-70" : ""}`}>
      <span className="text-sm text-gray-500 dark:text-slate-400">กรอง:</span>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setFilter(opt.value)}
          disabled={isPending}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors disabled:cursor-wait disabled:opacity-80 ${
            !isDeliveryFilter && current === opt.value
              ? "bg-[#1e3a5f] text-white border-[#1e3a5f] dark:bg-sky-500 dark:border-sky-500 dark:text-slate-950"
              : "bg-white text-gray-600 border-gray-200 hover:border-gray-400 dark:bg-slate-950 dark:text-slate-300 dark:border-white/10 dark:hover:border-white/20"
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
            ? "bg-purple-600 text-white border-purple-600 dark:bg-violet-500 dark:border-violet-500 dark:text-slate-950"
            : "bg-white text-gray-600 border-gray-200 hover:border-gray-400 dark:bg-slate-950 dark:text-slate-300 dark:border-white/10 dark:hover:border-white/20"
        }`}
      >
        {isDeliveryFilter && isPending ? <LoaderCircle size={13} className="mr-1 inline animate-spin" /> : null}
        รอจัดส่ง
      </button>

      <span className="mx-1 hidden h-5 w-px bg-gray-200 dark:bg-white/10 sm:inline-block" />
      <span className="text-sm text-gray-500 dark:text-slate-400">ชำระ:</span>
      {paymentStatusOptions.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setPaymentStatus(opt.value)}
          disabled={isPending}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors disabled:cursor-wait disabled:opacity-80 ${
            currentPaymentStatus === opt.value
              ? "bg-[#1e3a5f] text-white border-[#1e3a5f] dark:bg-sky-500 dark:border-sky-500 dark:text-slate-950"
              : "bg-white text-gray-600 border-gray-200 hover:border-gray-400 dark:bg-slate-950 dark:text-slate-300 dark:border-white/10 dark:hover:border-white/20"
          }`}
        >
          {currentPaymentStatus === opt.value && isPending ? <LoaderCircle size={13} className="mr-1 inline animate-spin" /> : null}
          {opt.label}
        </button>
      ))}

    </div>
  );
};

export default SalesFilterBar;
