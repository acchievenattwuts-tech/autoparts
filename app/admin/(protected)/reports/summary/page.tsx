export const dynamic = "force-dynamic";

import Link from "next/link";
import { requirePermission } from "@/lib/require-auth";
import { getReportsData, parseReportFilters } from "@/lib/reports";
import CashBankSnapshot from "../CashBankSnapshot";
import ReportsContent from "../ReportsContent";

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function SummaryReportPage({ searchParams }: PageProps) {
  await requirePermission("reports.view");
  const params = await searchParams;

  const filters = parseReportFilters({
    from: params.from,
    to: params.to,
  });

  const data = await getReportsData(filters);

  return (
    <div className="space-y-4">
      <form method="GET" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          ตั้งแต่วันที่
          <input
            type="date"
            name="from"
            defaultValue={filters.fromInput}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          ถึงวันที่
          <input
            type="date"
            name="to"
            defaultValue={filters.toInput}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <button
          type="submit"
          className="h-9 self-end rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055]"
        >
          แสดงรายงาน
        </button>
        <Link
          href="/admin/reports/summary"
          className="inline-flex h-9 items-center self-end rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200"
        >
          ล้าง
        </Link>
      </form>

      <CashBankSnapshot />

      <ReportsContent data={data} />
    </div>
  );
}
