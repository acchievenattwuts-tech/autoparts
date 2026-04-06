export const dynamic = "force-dynamic";

import BrowserPrintButton from "@/components/shared/BrowserPrintButton";
import { getReportsData, parseReportFilters } from "@/lib/reports";
import { requirePermission } from "@/lib/require-auth";
import CashBankSnapshot from "../CashBankSnapshot";
import ReportsContent from "../ReportsContent";

interface ReportsPrintPageProps {
  searchParams: Promise<{
    from?: string;
    to?: string;
    customerCodeFrom?: string;
    customerCodeTo?: string;
    supplierCodeFrom?: string;
    supplierCodeTo?: string;
    productCodeFrom?: string;
    productCodeTo?: string;
    expenseCodeFrom?: string;
    expenseCodeTo?: string;
  }>;
}

const ReportsPrintPage = async ({ searchParams }: ReportsPrintPageProps) => {
  await requirePermission("reports.view");
  const params = await searchParams;
  const filters = parseReportFilters(params);
  const data = await getReportsData(filters);

  return (
    <div className="mx-auto max-w-7xl space-y-6 bg-white p-4 print:p-0">
      <div className="flex items-start justify-between print:hidden">
        <div>
          <h1 className="font-kanit text-2xl font-bold text-gray-900">รายงานสำหรับพิมพ์ / PDF</h1>
          <p className="text-sm text-gray-500">
            ช่วงวันที่ {filters.fromInput} ถึง {filters.toInput}
          </p>
        </div>
        <BrowserPrintButton />
      </div>

      <div className="hidden print:block">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">รายงานสรุปกิจการ</h1>
        <p className="text-sm text-gray-600">
          ช่วงวันที่ {filters.fromInput} ถึง {filters.toInput}
        </p>
      </div>

      <CashBankSnapshot compact />

      <ReportsContent data={data} compact />
    </div>
  );
};

export default ReportsPrintPage;
