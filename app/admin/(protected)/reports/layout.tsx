import { BarChart3 } from "lucide-react";
import ReportTabNav from "./ReportTabNav";

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-0">
      <div className="flex items-center gap-3 mb-4">
        <BarChart3 size={22} className="text-[#1e3a5f]" />
        <div>
          <h1 className="font-kanit text-2xl font-bold text-gray-900">รายงาน</h1>
          <p className="text-sm text-gray-500">รายงาน Raw Data พร้อม Export Excel และรายงานสรุปภาพรวม</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 pt-4">
          <ReportTabNav />
        </div>
        <div className="p-4">
          {children}
        </div>
      </div>
    </div>
  );
}
