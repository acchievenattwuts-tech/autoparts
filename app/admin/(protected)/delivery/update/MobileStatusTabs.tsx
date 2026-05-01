"use client";

import Link from "next/link";
import LinkPendingIndicator from "@/components/shared/LinkPendingIndicator";

type Filter = "PENDING" | "OUT_FOR_DELIVERY" | "DELIVERED" | null;

type Counts = {
  PENDING:          number;
  OUT_FOR_DELIVERY: number;
};

type Tab = {
  label:     string;
  value:     Filter;
  count?:    (c: Counts) => number;
  showCount: boolean;
};

const TABS: Tab[] = [
  { label: "รอจัดส่ง + กำลังส่ง", value: null,               count: (c) => c.PENDING + c.OUT_FOR_DELIVERY, showCount: true },
  { label: "รอจัดส่ง",            value: "PENDING",          count: (c) => c.PENDING,          showCount: true },
  { label: "กำลังส่ง",            value: "OUT_FOR_DELIVERY", count: (c) => c.OUT_FOR_DELIVERY, showCount: true },
  { label: "ส่งแล้ว",             value: "DELIVERED",                                   showCount: false },
];

type Props = {
  current:  Filter;
  counts:   Counts;
  disabled: boolean;
};

const MobileStatusTabs = ({ current, counts, disabled }: Props) => (
  <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
    {TABS.map((tab) => {
      const active = current === tab.value;
      const href = tab.value
        ? `/admin/delivery/update?status=${tab.value}`
        : "/admin/delivery/update";
      const count = tab.count?.(counts);

      const baseClass = `relative inline-flex min-h-11 shrink-0 snap-start items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors ${
        active
          ? "bg-[#1e3a5f] text-white shadow-sm shadow-blue-950/10 dark:bg-[#1d4f7a] dark:text-white"
          : "border border-gray-200 bg-white text-gray-600 hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/10 dark:bg-transparent dark:text-slate-300 dark:hover:border-sky-400/40 dark:hover:text-sky-100"
      }`;

      const badge = tab.showCount && typeof count === "number" ? (
        <span
          className={`inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
            active
              ? "bg-white/20 text-white"
              : "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-slate-200"
          }`}
        >
          {count.toLocaleString("th-TH")}
        </span>
      ) : null;

      if (disabled) {
        return (
          <span
            key={tab.label}
            className={`${baseClass} cursor-not-allowed opacity-50`}
          >
            {tab.label}
            {badge}
          </span>
        );
      }

      return (
        <Link key={tab.label} href={href} className={baseClass}>
          <LinkPendingIndicator
            variant="chip"
            label="กำลังกรอง"
            className="right-1 top-1/2 -translate-y-1/2 rounded-full px-1.5 py-0.5 text-[10px]"
          />
          {tab.label}
          {badge}
        </Link>
      );
    })}
  </div>
);

export default MobileStatusTabs;
