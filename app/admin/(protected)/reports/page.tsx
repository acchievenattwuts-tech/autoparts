export const dynamic = "force-dynamic";

import Link from "next/link";
import { BarChart3, Download, FileSpreadsheet } from "lucide-react";
import BrowserPrintButton from "@/components/shared/BrowserPrintButton";
import { getReportsData, parseReportRange } from "@/lib/reports";
import { requirePermission } from "@/lib/require-auth";
import ReportsContent from "./ReportsContent";

interface ReportsPageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

const ReportsPage = async ({ searchParams }: ReportsPageProps) => {
  await requirePermission("reports.view");
  const { from, to } = await searchParams;
  const range = parseReportRange({ from, to });
  const data = await getReportsData(range);
  const query = new URLSearchParams({
    from: range.fromInput,
    to: range.toInput,
  }).toString();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 size={22} className="text-[#1e3a5f]" />
          <div>
            <h1 className="font-kanit text-2xl font-bold text-gray-900">รายงาน</h1>
            <p className="text-sm text-gray-500">สรุปยอดขาย, กำไรขาดทุน, สต็อกคงเหลือ และประกันใกล้หมด</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/admin/reports/export?${query}`}
            className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055]"
          >
            <FileSpreadsheet size={16} />
            Export Excel (CSV)
          </Link>
          <Link
            href={`/admin/reports/print?${query}`}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <Download size={16} />
            หน้า Export PDF
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div lang="en-GB" className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-gray-600">
              <span className="mb-1 block">ตั้งแต่วันที่</span>
              <input
                type="date"
                name="from"
                defaultValue={range.fromInput}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20"
              />
            </label>
            <label className="text-sm text-gray-600">
              <span className="mb-1 block">ถึงวันที่</span>
              <input
                type="date"
                name="to"
                defaultValue={range.toInput}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20"
              />
            </label>
          </div>
          <button
            type="submit"
            className="inline-flex items-center rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055]"
          >
            แสดงรายงาน
          </button>
          <Link
            href="/admin/reports"
            className="inline-flex items-center rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200"
          >
            ล้าง
          </Link>
          <div className="lg:ml-auto">
            <BrowserPrintButton />
          </div>
        </form>
      </div>

      <ReportsContent data={data} />
    </div>
  );
};

export default ReportsPage;
