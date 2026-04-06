"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "รายงานขาย",    href: "/admin/reports/sales" },
  { label: "รายงานซื้อ",    href: "/admin/reports/purchases" },
  { label: "คืนขาย (CN)",  href: "/admin/reports/credit-notes" },
  { label: "รับเงิน",       href: "/admin/reports/receipts" },
  { label: "จ่ายเงิน",      href: "/admin/reports/payments" },
  { label: "สรุปภาพรวม",   href: "/admin/reports/summary" },
];

export default function ReportTabNav() {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap gap-1 border-b border-gray-200 pb-0">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
              active
                ? "border-[#1e3a5f] text-[#1e3a5f] bg-white"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
