export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { FileSpreadsheet, FileText } from "lucide-react";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import SearchableSelectFilter from "@/components/shared/SearchableSelectFilter";
import { requirePermission } from "@/lib/require-auth";
import { db } from "@/lib/db";
import {
  parseARAPStockFilters,
  type ARAPStockFilters,
} from "@/lib/ar-ap-stock-report-queries";

import ReportResultsSkeleton from "../ReportResultsSkeleton";
import ARReportResults from "./ARReportResults";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

function buildQuery(
  filters: ARAPStockFilters,
  customerId: string | undefined,
  view: "outstanding" | "register",
): string {
  const params = new URLSearchParams();
  params.set("from", filters.fromStr);
  params.set("to", filters.toStr);
  if (customerId) params.set("customerId", customerId);
  if (filters.arMode && filters.arMode !== "ALL") params.set("arMode", filters.arMode);
  if (view === "register") params.set("view", "register");
  return params.toString();
}

export default async function ARReportPage({ searchParams }: PageProps) {
  const [, params] = await Promise.all([requirePermission("reports.view"), searchParams]);
  const filters = parseARAPStockFilters(params);
  const view: "outstanding" | "register" = params.view === "register" ? "register" : "outstanding";
  const exportQuery = buildQuery(filters, params.customerId, view);

  // Only the customer dropdown the filter form needs is awaited here; the AR
  // rows stream in behind <Suspense>.
  const customers = await db.customer.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
    take: 500,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">ลูกหนี้ค้างชำระ (AR)</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          รายการขายเชื่อที่ยังค้างชำระ สามารถกรองเฉพาะลูกหนี้ COD ได้
        </p>
      </div>

      <AdminSearchForm method="GET" className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          วันที่ขาย (ตั้งแต่)
          <input
            type="date"
            name="from"
            defaultValue={filters.fromStr}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          วันที่ขาย (ถึง)
          <input
            type="date"
            name="to"
            defaultValue={filters.toStr}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          ลูกค้า
          <div className="min-w-[14rem]">
            <SearchableSelectFilter
              name="customerId"
              defaultValue={params.customerId ?? ""}
              options={customers.map((c) => ({ id: c.id, label: c.name }))}
              placeholder="ทุกลูกค้า"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          มุมมอง
          <select
            name="view"
            defaultValue={view}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="outstanding">รายงานเดิม (ค้างชำระ)</option>
            <option value="register">Register (ทะเบียนเอกสาร)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          ประเภทลูกหนี้
          <select
            name="arMode"
            defaultValue={filters.arMode ?? "ALL"}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="ALL">ทั้งหมด</option>
            <option value="NORMAL">ลูกหนี้ทั่วไป</option>
            <option value="COD">ลูกหนี้ COD</option>
          </select>
        </label>
        <AdminSearchSubmitButton className="h-9 rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055] dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400">
          แสดงรายการ
        </AdminSearchSubmitButton>
        <Link
          href="/admin/reports/ar"
          className="inline-flex h-9 items-center rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
        >
          ล้าง
        </Link>
        <div className="ml-auto flex gap-2">
          <Link
            href={`/admin/reports/export?type=ar&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-gray-600 px-3 text-sm font-medium text-white hover:bg-gray-700 dark:bg-slate-700 dark:hover:bg-slate-600"
          >
            <FileText size={14} />
            CSV
          </Link>
          <Link
            href={`/admin/reports/export-excel?type=ar&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-3 text-sm font-medium text-white hover:bg-green-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            <FileSpreadsheet size={14} />
            Excel
          </Link>
        </div>
      </AdminSearchForm>

      {!filters.hasFilter ? (
        <div className="rounded-xl border border-gray-100 bg-white p-12 text-center shadow-sm dark:border-white/10 dark:bg-slate-950/40">
          <p className="text-gray-400 dark:text-slate-500">เลือกช่วงวันที่แล้วกด “แสดงรายการ” เพื่อดูข้อมูล</p>
        </div>
      ) : (
        <Suspense key={exportQuery} fallback={<ReportResultsSkeleton />}>
          <ARReportResults filters={filters} view={view} />
        </Suspense>
      )}
    </div>
  );
}
