import AdminPageHeader from "@/components/shared/AdminPageHeader";
import ReportTabNav from "./ReportTabNav";

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
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
        <div className="p-4">
          {children}
        </div>
      </div>
    </div>
  );
}
