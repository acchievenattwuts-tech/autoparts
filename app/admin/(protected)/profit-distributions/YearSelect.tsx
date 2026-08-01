"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

type Props = {
  years: number[];
  value: number;
};

const YearSelect = ({ years, value }: Props) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-slate-300">
      <span className="whitespace-nowrap">ปี</span>
      <select
        value={value}
        disabled={isPending}
        onChange={(event) => {
          const nextYear = event.target.value;
          startTransition(() => {
            router.push(`/admin/profit-distributions?year=${nextYear}`);
          });
        }}
        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-sky-400 disabled:opacity-60 dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
      >
        {years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
      {isPending ? <span className="text-xs text-gray-400 dark:text-slate-500">กำลังโหลด...</span> : null}
    </label>
  );
};

export default YearSelect;
