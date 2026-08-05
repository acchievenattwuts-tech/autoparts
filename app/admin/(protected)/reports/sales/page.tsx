export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { FileSpreadsheet, FileText } from "lucide-react";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import SearchableSelectFilter from "@/components/shared/SearchableSelectFilter";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { buildExportQuery, parseReportQueryFilters } from "@/lib/report-queries";

import ReportResultsSkeleton from "../ReportResultsSkeleton";
import SalesReportResults from "./SalesReportResults";

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function SalesReportPage({ searchParams }: PageProps) {
  const [, params] = await Promise.all([requirePermission("reports.view"), searchParams]);
  const filters = parseReportQueryFilters(params);
  const pageNo = Math.max(0, parseInt(params.page ?? "0"));
  const exportQuery = buildExportQuery(filters);

  // Only the dropdown the filter form itself needs is awaited here — the report
  // rows/totals stream in behind <Suspense> so the filters stay usable while
  // the query runs.
  const accounts = await db.cashBankAccount.findMany({
    where: { isActive: true },
    orderBy: [{ type: "asc" }, { code: "asc" }],
    select: { id: true, code: true, name: true },
  });

  return (
    <div className="space-y-4">
      <AdminPageHeader
        eyebrow="รายงาน"
        title="Sales Register"
        description="ดูรายการขายแบบรายบรรทัดสินค้า พร้อมประเภทการขาย ช่องทางรับเงิน และบัญชีเงินที่รับจริง"
      />

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
          ประเภทการชำระ
          <select
            name="paymentType"
            defaultValue={filters.paymentType ?? "ALL"}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="ALL">ทั้งหมด</option>
            <option value="CASH_SALE">เงินสด</option>
            <option value="CREDIT_SALE">เชื่อ</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          ประเภทการขาย
          <select
            name="saleType"
            defaultValue={filters.saleType ?? "ALL"}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="ALL">ทั้งหมด</option>
            <option value="RETAIL">ปลีก</option>
            <option value="WHOLESALE">ส่ง</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          ช่องทาง
          <select
            name="channel"
            defaultValue={filters.channel ?? "ALL"}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="ALL">ทุกช่องทาง</option>
            <option value="STORE">หน้าร้าน</option>
            <option value="SHOPEE">Shopee</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          บัญชีรับเงิน
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
          href="/admin/reports/sales"
          className="inline-flex h-9 items-center self-end rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200"
        >
          ล้าง
        </Link>
        <div className="ml-auto flex gap-2 self-end">
          <Link
            href={`/admin/reports/export?type=sales&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-gray-600 px-3 text-sm font-medium text-white hover:bg-gray-700"
          >
            <FileText size={14} />
            CSV
          </Link>
          <Link
            href={`/admin/reports/export-excel?type=sales&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-3 text-sm font-medium text-white hover:bg-green-700"
          >
            <FileSpreadsheet size={14} />
            Excel
          </Link>
        </div>
      </AdminSearchForm>

      {!filters.hasFilter ? (
        <div className="rounded-xl border border-gray-100 bg-white p-12 text-center shadow-sm">
          <p className="text-gray-400">เลือกช่วงวันที่แล้วกด &ldquo;แสดงรายการ&rdquo; เพื่อดูข้อมูล</p>
        </div>
      ) : (
        <Suspense
          key={`${filters.fromStr}|${filters.toStr}|${exportQuery}|${pageNo}`}
          fallback={<ReportResultsSkeleton />}
        >
          <SalesReportResults filters={filters} pageNo={pageNo} params={params} />
        </Suspense>
      )}
    </div>
  );
}
