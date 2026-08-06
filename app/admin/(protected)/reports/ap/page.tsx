export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { FileSpreadsheet, FileText } from "lucide-react";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import SearchableSelectFilter from "@/components/shared/SearchableSelectFilter";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import {
  parseARAPStockFilters,
  type ARAPStockFilters,
} from "@/lib/ar-ap-stock-report-queries";

import ReportResultsSkeleton from "../ReportResultsSkeleton";
import APReportResults from "./APReportResults";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

function buildQuery(
  filters: ARAPStockFilters,
  supplierId: string | undefined,
  view: "outstanding" | "register",
): string {
  const params = new URLSearchParams();
  params.set("from", filters.fromStr);
  params.set("to", filters.toStr);
  if (supplierId) params.set("supplierId", supplierId);
  if (view === "register") params.set("view", "register");
  return params.toString();
}

export default async function APReportPage({ searchParams }: PageProps) {
  const [, params] = await Promise.all([requirePermission("reports.view"), searchParams]);
  const filters = parseARAPStockFilters(params);
  const view: "outstanding" | "register" = params.view === "register" ? "register" : "outstanding";
  const exportQuery = buildQuery(filters, params.supplierId, view);

  // Only the supplier dropdown the filter form needs is awaited here; the AP
  // rows stream in behind <Suspense>.
  const suppliers = await db.supplier.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
    take: 500,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">เจ้าหนี้คงค้าง (AP)</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          ยอดค้างจ่ายซัพพลายเออร์ เงินมัดจำคงเหลือ และเครดิต CN คืนสินค้า
        </p>
      </div>

      <AdminSearchForm method="GET" className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          วันที่เอกสาร (ตั้งแต่)
          <input
            type="date"
            name="from"
            defaultValue={filters.fromStr}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          วันที่เอกสาร (ถึง)
          <input
            type="date"
            name="to"
            defaultValue={filters.toStr}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          มุมมอง
          <select
            name="view"
            defaultValue={view}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="outstanding">รายงานเดิม (คงค้าง)</option>
            <option value="register">Register (ทะเบียนเอกสาร)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          ซัพพลายเออร์
          <div className="min-w-[14rem]">
            <SearchableSelectFilter
              name="supplierId"
              defaultValue={params.supplierId ?? ""}
              options={suppliers.map((s) => ({ id: s.id, label: s.name }))}
              placeholder="ทั้งหมด"
            />
          </div>
        </label>
        <AdminSearchSubmitButton className="h-9 rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055] dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400">
          แสดงรายการ
        </AdminSearchSubmitButton>
        <Link
          href="/admin/reports/ap"
          className="inline-flex h-9 items-center rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
        >
          ล้าง
        </Link>
        <div className="ml-auto flex gap-2">
          <Link
            href={`/admin/reports/export?type=ap&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-gray-600 px-3 text-sm font-medium text-white hover:bg-gray-700 dark:bg-slate-700 dark:hover:bg-slate-600"
          >
            <FileText size={14} />
            CSV
          </Link>
          <Link
            href={`/admin/reports/export-excel?type=ap&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-3 text-sm font-medium text-white hover:bg-green-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            <FileSpreadsheet size={14} />
            Excel
          </Link>
        </div>
      </AdminSearchForm>

      {!filters.hasFilter ? (
        <div className="rounded-xl border border-gray-100 bg-white p-12 text-center shadow-sm dark:border-white/10 dark:bg-slate-950/40">
          <p className="text-gray-400 dark:text-slate-500">เลือกช่วงวันที่แล้วกด &ldquo;แสดงรายการ&rdquo; เพื่อดูข้อมูล</p>
        </div>
      ) : (
        <Suspense key={exportQuery} fallback={<ReportResultsSkeleton />}>
          <APReportResults filters={filters} view={view} />
        </Suspense>
      )}
    </div>
  );
}
