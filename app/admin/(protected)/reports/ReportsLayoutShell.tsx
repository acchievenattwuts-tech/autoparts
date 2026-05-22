"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import AdminPageHeader from "@/components/shared/AdminPageHeader";

import ReportTabNav from "./ReportTabNav";

const STANDALONE_REPORT_PATHS = new Set([
  "/admin/reports/product-search-no-result",
  "/admin/reports/search-coverage-audit",
]);

export default function ReportsLayoutShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (STANDALONE_REPORT_PATHS.has(pathname)) {
    return <div className="space-y-4">{children}</div>;
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader
        eyebrow="รายงาน"
        title="รายงาน"
        description="รายงาน Raw Data พร้อม Export Excel และรายงานสรุปภาพรวม"
      />

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/80">
        <div className="px-4 pt-4">
          <ReportTabNav />
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
