"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";

interface DateRangeFilterProps {
  from: string;
  to: string;
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
      <span className="whitespace-nowrap text-gray-500 dark:text-slate-400">ช่วงวันที่</span>
      <input
        type="date"
        value={from}
        onChange={(e) => handleChange("from", e.target.value)}
        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 dark:border-white/10 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-sky-400/20"
        disabled={isPending}
      />
      <span className="text-gray-400 dark:text-slate-500">-</span>
      <input
        type="date"
        value={to}
        onChange={(e) => handleChange("to", e.target.value)}
        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 dark:border-white/10 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-sky-400/20"
        disabled={isPending}
      />
      <span className={`inline-flex h-4 w-4 items-center justify-center text-[#1e3a5f] transition-opacity ${isPending ? "opacity-100" : "opacity-0"}`}>
        <LoaderCircle size={14} className="animate-spin" />
      </span>
    </div>
  );
};

export default DateRangeFilter;
