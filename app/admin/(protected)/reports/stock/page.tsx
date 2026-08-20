export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { FileSpreadsheet, FileText } from "lucide-react";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import AdminExportLink from "@/components/shared/AdminExportLink";
import SearchableSelectFilter from "@/components/shared/SearchableSelectFilter";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { parseARAPStockFilters } from "@/lib/ar-ap-stock-report-queries";

import ReportResultsSkeleton from "../ReportResultsSkeleton";
import StockReportResults from "./StockReportResults";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function StockReportPage({ searchParams }: PageProps) {
  const [, params] = await Promise.all([requirePermission("reports.view"), searchParams]);
  const filters = parseARAPStockFilters(params);

  // Only the category dropdown the filter form needs is awaited here; the stock
  // rows stream in behind <Suspense>.
  const categories = await db.category.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const exportQuery = new URLSearchParams({
    ...(params.categoryId ? { categoryId: params.categoryId } : {}),
    ...(params.search ? { search: params.search } : {}),
    ...(params.showAll === "1" ? { showAll: "1" } : {}),
  }).toString();

  return (
    <div className="space-y-4">
      <AdminPageHeader
        eyebrow="รายงาน"
        title="Stock คงเหลือ"
        description="ยอดสินค้าคงเหลือปัจจุบันตามหน่วยนับรายงาน พร้อมต้นทุนเฉลี่ยและมูลค่าสต็อก"
      />

      <AdminSearchForm
        method="GET"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950"
      >
        <input type="hidden" name="submitted" value="1" />
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300 sm:flex-none">
          ค้นหาสินค้า
          <input
            type="text"
            name="search"
            defaultValue={params.search ?? ""}
            placeholder="ชื่อหรือรหัสสินค้า"
            className="h-9 w-full max-w-[20rem] rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring md:max-w-[28rem]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          หมวดหมู่
          <div className="min-w-[14rem]">
            <SearchableSelectFilter
              name="categoryId"
              defaultValue={params.categoryId ?? ""}
              options={categories.map((category) => ({ id: category.id, label: category.name }))}
              placeholder="ทุกหมวดหมู่"
            />
          </div>
        </label>
        <label className="flex items-center gap-2 self-end pb-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          <input
            type="checkbox"
            name="showAll"
            value="1"
            defaultChecked={params.showAll === "1"}
            className="rounded"
          />
          รวมสินค้าสต็อก 0
        </label>
        <AdminSearchSubmitButton className="h-9 rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055]">
          แสดงรายการ
        </AdminSearchSubmitButton>
        <Link
          href="/admin/reports/stock"
          className="inline-flex h-9 items-center rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          ล้าง
        </Link>
        <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
          <AdminExportLink
            href={`/admin/reports/export?type=stock&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-gray-600 px-3 text-sm font-medium text-white hover:bg-gray-700"
          >
            <FileText size={14} />
            CSV
          </AdminExportLink>
          <AdminExportLink
            href={`/admin/reports/export-excel?type=stock&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-3 text-sm font-medium text-white hover:bg-green-700"
          >
            <FileSpreadsheet size={14} />
            Excel
          </AdminExportLink>
        </div>
      </AdminSearchForm>

      {filters.hasFilter ? (
        <Suspense key={exportQuery} fallback={<ReportResultsSkeleton />}>
          <StockReportResults filters={filters} />
        </Suspense>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-6 py-12 text-center shadow-sm dark:border-white/10 dark:bg-slate-950">
          <p className="font-medium text-gray-700 dark:text-slate-200">ยังไม่ได้แสดงข้อมูล</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            ระบุคำค้นหา หมวดหมู่ หรือเลือก รวมสินค้าสต็อก 0 แล้วกดแสดงรายการ
          </p>
        </div>
      )}
    </div>
  );
}
