"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

const SalesFilterBar = () => {
  const router      = useRouter();
  const pathname    = usePathname();
  const searchParams = useSearchParams();

  const current = searchParams.get("paymentType") ?? "ALL";

  const setFilter = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "ALL") {
      params.delete("paymentType");
    } else {
      params.set("paymentType", value);
    }
    router.push(`${pathname}?${params.toString()}`);
  };

  const options = [
    { value: "ALL",         label: "ทั้งหมด" },
    { value: "CASH_SALE",   label: "ขายสด (SA)" },
    { value: "CREDIT_SALE", label: "ขายเชื่อ (SAC)" },
  ];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm text-gray-500">กรอง:</span>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setFilter(opt.value)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
            current === opt.value
              ? "bg-[#1e3a5f] text-white border-[#1e3a5f]"
              : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
};

export default SalesFilterBar;
