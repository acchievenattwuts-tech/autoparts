"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import LinkPendingIndicator from "@/components/shared/LinkPendingIndicator";

const TABS = [
  { label: "รายงานขาย", href: "/admin/reports/sales" },
  { label: "รายงานซื้อ", href: "/admin/reports/purchases" },
  { label: "คืนขาย (CN)", href: "/admin/reports/credit-notes" },
  { label: "รับเงิน", href: "/admin/reports/receipts" },
  { label: "จ่ายเงิน", href: "/admin/reports/payments" },
  { label: "ลูกหนี้ (AR)", href: "/admin/reports/ar" },
  { label: "เจ้าหนี้ (AP)", href: "/admin/reports/ap" },
  { label: "สต็อกคงเหลือ", href: "/admin/reports/stock" },
  { label: "รายงานสต็อกเคลม", href: "/admin/reports/claim-stock" },
  { label: "บัญชีเงินสด / ธนาคาร", href: "/admin/reports/cash-bank-ledger" },
  { label: "ประวัติโอนเงิน", href: "/admin/reports/cash-bank-transfers" },
  { label: "ประวัติปรับยอดเงิน", href: "/admin/reports/cash-bank-adjustments" },
  { label: "สรุปภาพรวม", href: "/admin/reports/summary" },
  { label: "LINE สรุปรายวัน", href: "/admin/reports/line-daily-summary" },
];

export default function ReportTabNav() {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap gap-1 border-b border-gray-200 pb-0 dark:border-white/10">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`inline-flex items-center gap-2 rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-[#1e3a5f] bg-white text-[#1e3a5f] dark:border-sky-300 dark:bg-slate-900 dark:text-sky-200"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-slate-400 dark:hover:border-white/20 dark:hover:text-slate-200"
            }`}
          >
            {tab.label}
            <LinkPendingIndicator className={active ? "text-current" : "text-gray-400"} />
          </Link>
        );
      })}
    </div>
  );
}
