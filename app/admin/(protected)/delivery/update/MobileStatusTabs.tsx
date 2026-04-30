"use client";

import Link from "next/link";
import LinkPendingIndicator from "@/components/shared/LinkPendingIndicator";

type Filter = "PENDING" | "OUT_FOR_DELIVERY" | "DELIVERED" | null;

type Counts = {
  all:              number;
  PENDING:          number;
  OUT_FOR_DELIVERY: number;
  DELIVERED:        number;
};

type Tab = {
  label: string;
  value: Filter;
  count: (c: Counts) => number;
};

const TABS: Tab[] = [
  { label: "ทั้งหมด",   value: null,               count: (c) => c.all },
  { label: "รอจัดส่ง",  value: "PENDING",          count: (c) => c.PENDING },
  { label: "กำลังส่ง",  value: "OUT_FOR_DELIVERY", count: (c) => c.OUT_FOR_DELIVERY },
  { label: "ส่งแล้ว",   value: "DELIVERED",        count: (c) => c.DELIVERED },
];

type Props = {
  current:  Filter;
  counts:   Counts;
  disabled: boolean;
};

const MobileStatusTabs = ({ current, counts, disabled }: Props) => (
  <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
    {TABS.map((tab) => {
      const active = current === tab.value;
      const href = tab.value
        ? `/admin/delivery/update?status=${tab.value}`
        : "/admin/delivery/update";
      const count = tab.count(counts);

      const baseClass = `relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-[#1e3a5f] text-white shadow-sm"
          : "border border-gray-200 bg-white text-gray-600 hover:border-[#1e3a5f] dark:border-white/10 dark:bg-slate-900 dark:text-slate-300"
      }`;

      const badge = (
        <span
          className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${
            active
              ? "bg-white/20 text-white"
              : "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-slate-200"
          }`}
        >
          {count.toLocaleString("th-TH")}
        </span>
      );

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
