export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { FileSpreadsheet, FileText } from "lucide-react";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import AdminExportLink from "@/components/shared/AdminExportLink";
import SearchableSelectFilter from "@/components/shared/SearchableSelectFilter";
import { requirePermission } from "@/lib/require-auth";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import { parseCashBankReportFilters } from "@/lib/cash-bank-report-queries";

import ReportResultsSkeleton from "../ReportResultsSkeleton";
import CashBankLedgerResults from "./CashBankLedgerResults";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

function buildQuery(filters: ReturnType<typeof parseCashBankReportFilters>): string {
  const params = new URLSearchParams();
  params.set("from", filters.fromStr);
  params.set("to", filters.toStr);
  if (filters.accountId) params.set("accountId", filters.accountId);
  if (filters.sourceType !== "ALL") params.set("sourceType", filters.sourceType);
  return params.toString();
}

export default async function CashBankLedgerReportPage({ searchParams }: PageProps) {
  const [, params] = await Promise.all([requirePermission("reports.view"), searchParams]);
  const filters = parseCashBankReportFilters(params);
  const exportQuery = buildQuery(filters);

  // Only the account dropdown the filter form needs is awaited here; the ledger
  // itself streams in behind <Suspense>.
  const accounts = await getActiveCashBankAccountOptions();

  return (
    <div className="space-y-4">
      <AdminSearchForm method="GET" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          บัญชี
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
          Source
          <select
            name="sourceType"
            defaultValue={filters.sourceType}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="ALL">ทั้งหมด</option>
            <option value="SALE">SALE</option>
            <option value="RECEIPT">RECEIPT</option>
            <option value="PURCHASE">PURCHASE</option>
            <option value="EXPENSE">EXPENSE</option>
            <option value="CN_SALE">CN_SALE</option>
            <option value="CN_PURCHASE">CN_PURCHASE</option>
            <option value="SUPPLIER_ADVANCE">SUPPLIER_ADVANCE</option>
            <option value="SUPPLIER_PAYMENT">SUPPLIER_PAYMENT</option>
            <option value="TRANSFER">TRANSFER</option>
            <option value="ADJUSTMENT">ADJUSTMENT</option>
          </select>
        </label>
        <AdminSearchSubmitButton className="h-9 rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055]">
          แสดงรายงาน
        </AdminSearchSubmitButton>
        <Link
          href="/admin/reports/cash-bank-ledger"
          className="inline-flex h-9 items-center rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200"
        >
          ล้าง
        </Link>
        <div className="ml-auto flex gap-2">
          <AdminExportLink
            href={`/admin/reports/export?type=cash-bank-ledger&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-gray-600 px-3 text-sm font-medium text-white hover:bg-gray-700"
          >
            <FileText size={14} />
            CSV
          </AdminExportLink>
          <AdminExportLink
            href={`/admin/reports/export-excel?type=cash-bank-ledger&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-3 text-sm font-medium text-white hover:bg-green-700"
          >
            <FileSpreadsheet size={14} />
            Excel
          </AdminExportLink>
        </div>
      </AdminSearchForm>

      {!filters.hasFilter ? (
        <div className="rounded-xl border border-gray-100 bg-white p-12 text-center shadow-sm dark:border-white/10 dark:bg-slate-950/40">
          <p className="text-gray-400 dark:text-slate-500">เลือกช่วงวันที่แล้วกด &ldquo;แสดงรายการ&rdquo; เพื่อดูข้อมูล</p>
        </div>
      ) : (
        <Suspense key={exportQuery} fallback={<ReportResultsSkeleton />}>
          <CashBankLedgerResults filters={filters} />
        </Suspense>
      )}
    </div>
  );
}
