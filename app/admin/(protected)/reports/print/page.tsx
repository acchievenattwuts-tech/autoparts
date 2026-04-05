export const dynamic = "force-dynamic";

import BrowserPrintButton from "@/components/shared/BrowserPrintButton";
import { getReportsData, parseReportRange } from "@/lib/reports";
import { requirePermission } from "@/lib/require-auth";
import ReportsContent from "../ReportsContent";

interface ReportsPrintPageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

const ReportsPrintPage = async ({ searchParams }: ReportsPrintPageProps) => {
  await requirePermission("reports.view");
  const { from, to } = await searchParams;
  const range = parseReportRange({ from, to });
  const data = await getReportsData(range);

  return (
    <div className="mx-auto max-w-7xl space-y-6 bg-white p-4 print:p-0">
      <div className="flex items-start justify-between print:hidden">
        <div>
          <h1 className="font-kanit text-2xl font-bold text-gray-900">รายงานสำหรับพิมพ์ / PDF</h1>
          <p className="text-sm text-gray-500">
            ช่วงวันที่ {range.fromInput} ถึง {range.toInput}
          </p>
        </div>
        <BrowserPrintButton />
      </div>

      <div className="hidden print:block">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">รายงานสรุปกิจการ</h1>
        <p className="text-sm text-gray-600">
          ช่วงวันที่ {range.fromInput} ถึง {range.toInput}
        </p>
      </div>

      <ReportsContent data={data} compact />
    </div>
  );
};

export default ReportsPrintPage;
