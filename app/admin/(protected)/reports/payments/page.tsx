export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { FileSpreadsheet, FileText } from "lucide-react";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import SearchableSelectFilter from "@/components/shared/SearchableSelectFilter";
import { requirePermission } from "@/lib/require-auth";
import { db } from "@/lib/db";
import { buildExportQuery, parseReportQueryFilters } from "@/lib/report-queries";

import ReportResultsSkeleton from "../ReportResultsSkeleton";
import PaymentsReportResults, {
  EMPTY_PAYMENT_TOTALS,
  PaymentSummaryCards,
} from "./PaymentsReportResults";

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function DailyPaymentPage({ searchParams }: PageProps) {
  const [, params] = await Promise.all([requirePermission("reports.view"), searchParams]);
  const filters = parseReportQueryFilters(params);
  const exportQuery = buildExportQuery(filters);

  const accounts = await db.cashBankAccount.findMany({
    where: { isActive: true },
    orderBy: [{ type: "asc" }, { code: "asc" }],
    select: { id: true, code: true, name: true },
  });

  return (
    <div className="space-y-4">
      <AdminSearchForm method="GET" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          ตั้งแต่วันที่
          <input
            type="date"
            name="from"
            defaultValue={filters.fromStr}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          ถึงวันที่
          <input
            type="date"
            name="to"
            defaultValue={filters.toStr}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          ประเภทรายการ
          <select
            name="docType"
            defaultValue={filters.docType ?? "ALL"}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="ALL">ทั้งหมด</option>
            <option value="PURCHASE">ซื้อสินค้า</option>
            <option value="EXPENSE">ค่าใช้จ่าย</option>
            <option value="SUPPLIER_ADVANCE">เงินมัดจำซัพพลายเออร์</option>
            <option value="SUPPLIER_PAYMENT">จ่ายชำระซัพพลายเออร์</option>
            <option value="CN_REFUND">คืนเงินลูกค้า (CN)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Account
          <div className="min-w-[14rem]">
            <SearchableSelectFilter
              name="accountId"
              defaultValue={filters.accountId ?? ""}
              options={accounts.map((account) => ({
                id: account.id,
                label: `${account.code} - ${account.name}`,
              }))}
              placeholder="ทุกบัญชี"
            />
          </div>
        </label>
        <label className="mb-1 flex items-center gap-2 self-end text-sm text-gray-600">
          <input
            type="checkbox"
            name="showCancelled"
            value="1"
            defaultChecked={filters.showCancelled}
            className="h-4 w-4 rounded border-gray-300"
          />
          รวมที่ยกเลิก
        </label>
        <AdminSearchSubmitButton className="h-9 self-end rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055]">
          แสดงรายงาน
        </AdminSearchSubmitButton>
        <Link
          href="/admin/reports/payments"
          className="inline-flex h-9 items-center self-end rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200"
        >
          ล้าง
        </Link>
        <div className="ml-auto flex gap-2 self-end">
          <Link
            href={`/admin/reports/export?type=daily-payment&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-gray-600 px-3 text-sm font-medium text-white hover:bg-gray-700"
          >
            <FileText size={14} />
            CSV
          </Link>
          <Link
            href={`/admin/reports/export-excel?type=daily-payment&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-3 text-sm font-medium text-white hover:bg-green-700"
          >
            <FileSpreadsheet size={14} />
            Excel
          </Link>
        </div>
      </AdminSearchForm>

      {!filters.hasFilter ? (
        <>
          <PaymentSummaryCards totals={EMPTY_PAYMENT_TOTALS} />
          <div className="rounded-xl border border-gray-100 bg-white p-12 text-center shadow-sm">
            <p className="text-gray-400">เลือกช่วงวันที่แล้วกด &ldquo;แสดงรายการ&rdquo; เพื่อดูข้อมูล</p>
          </div>
        </>
      ) : (
        <Suspense
          key={`${filters.fromStr}|${filters.toStr}|${exportQuery}`}
          fallback={
            <>
              <PaymentSummaryCards totals={EMPTY_PAYMENT_TOTALS} />
              <ReportResultsSkeleton />
            </>
          }
        >
          <PaymentsReportResults filters={filters} />
        </Suspense>
      )}
    </div>
  );
}
