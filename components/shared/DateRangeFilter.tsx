"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";

interface DateRangeFilterProps {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

const DateRangeFilter = ({ from, to }: DateRangeFilterProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const handleChange = (key: "from" | "to", value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <div lang="en-GB" className={`flex items-center gap-2 text-sm transition-opacity ${isPending ? "opacity-50" : ""}`}>
      <span className="text-gray-500 whitespace-nowrap">ช่วงวันที่</span>
      <input
        type="date"
        value={from}
        onChange={(e) => handleChange("from", e.target.value)}
        className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20"
      />
      <span className="text-gray-400">–</span>
      <input
        type="date"
        value={to}
        onChange={(e) => handleChange("to", e.target.value)}
        className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20"
      />
    </div>
  );
};

export default DateRangeFilter;
