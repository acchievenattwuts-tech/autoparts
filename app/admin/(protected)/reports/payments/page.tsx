import { getAdminReportRowClass } from "@/lib/admin-status-presentation";
export const dynamic = "force-dynamic";

import Link from "next/link";
import { FileSpreadsheet, FileText } from "lucide-react";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import ReportTableShell from "@/components/shared/ReportTableShell";
import SearchableSelectFilter from "@/components/shared/SearchableSelectFilter";
import { requirePermission } from "@/lib/require-auth";
import { db } from "@/lib/db";
import {
  parseReportQueryFilters,
  queryDailyPaymentRows,
  buildExportQuery,
  statusLabel,
  type DailyPaymentRow,
} from "@/lib/report-queries";
import { formatDateThai } from "@/lib/th-date";

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

function fmt(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: Date) {
  return formatDateThai(d);
}

const DOC_TYPE_COLORS: Record<string, string> = {
  "ซื้อสินค้า": "bg-blue-100 text-blue-700 dark:bg-blue-500/25 dark:text-blue-200",
  "ค่าใช้จ่าย": "bg-orange-100 text-orange-700 dark:bg-orange-500/25 dark:text-orange-200",
  "คืนเงินลูกค้า": "bg-purple-100 text-purple-700 dark:bg-purple-500/25 dark:text-purple-200",
  "เงินมัดจำซัพพลายเออร์": "bg-amber-100 text-amber-700 dark:bg-amber-500/25 dark:text-amber-200",
  "จ่ายชำระซัพพลายเออร์": "bg-teal-100 text-teal-700 dark:bg-teal-500/25 dark:text-teal-200",
};

const PM_COLORS: Record<string, string> = {
  "เงินสด": "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/25 dark:text-emerald-200",
  "โอนเงิน": "bg-sky-100 text-sky-700 dark:bg-sky-500/25 dark:text-sky-200",
  "เครดิต": "bg-purple-100 text-purple-700 dark:bg-purple-500/25 dark:text-purple-200",
};

export default async function DailyPaymentPage({ searchParams }: PageProps) {
  await requirePermission("reports.view");
  const params = await searchParams;
  const filters = parseReportQueryFilters(params);
  const [rows, accounts] = await Promise.all([
    filters.hasFilter ? queryDailyPaymentRows(filters) : Promise.resolve([]),
    db.cashBankAccount.findMany({
      where: { isActive: true },
      orderBy: [{ type: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true },
    }),
  ]);

  const totalAmount = rows.filter((r) => r.status === "ACTIVE").reduce((s, r) => s + r.amount, 0);
  const purchaseTotal = rows
    .filter((r) => r.docType === "ซื้อสินค้า" && r.status === "ACTIVE")
    .reduce((s, r) => s + r.amount, 0);
  const expenseTotal = rows
    .filter((r) => r.docType === "ค่าใช้จ่าย" && r.status === "ACTIVE")
    .reduce((s, r) => s + r.amount, 0);
  const cnRefundTotal = rows
    .filter((r) => r.docType === "คืนเงินลูกค้า" && r.status === "ACTIVE")
    .reduce((s, r) => s + r.amount, 0);
  const supplierAdvanceTotal = rows
    .filter((r) => r.docType === "เงินมัดจำซัพพลายเออร์" && r.status === "ACTIVE")
    .reduce((s, r) => s + r.amount, 0);
  const supplierPaymentTotal = rows
    .filter((r) => r.docType === "จ่ายชำระซัพพลายเออร์" && r.status === "ACTIVE")
    .reduce((s, r) => s + r.amount, 0);
  const exportQuery = buildExportQuery(filters);

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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-lg border border-gray-100 bg-white p-3 shadow-sm">
          <p className="text-xs text-gray-500">รวมจ่ายเงิน (เฉพาะที่ใช้งาน)</p>
          <p className="mt-0.5 text-xl font-bold text-[#1e3a5f] tabular-nums">{fmt(totalAmount)}</p>
        </div>
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 shadow-sm">
          <p className="text-xs text-blue-700">ซื้อสินค้า</p>
          <p className="mt-0.5 text-xl font-bold text-blue-700 tabular-nums">{fmt(purchaseTotal)}</p>
        </div>
        <div className="rounded-lg border border-orange-100 bg-orange-50 p-3 shadow-sm">
          <p className="text-xs text-orange-700">ค่าใช้จ่าย</p>
          <p className="mt-0.5 text-xl font-bold text-orange-700 tabular-nums">{fmt(expenseTotal)}</p>
        </div>
        <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 shadow-sm">
          <p className="text-xs text-amber-700">เงินมัดจำซัพพลายเออร์</p>
          <p className="mt-0.5 text-xl font-bold text-amber-700 tabular-nums">{fmt(supplierAdvanceTotal)}</p>
        </div>
        <div className="rounded-lg border border-teal-100 bg-teal-50 p-3 shadow-sm">
          <p className="text-xs text-teal-700">จ่ายชำระซัพพลายเออร์</p>
          <p className="mt-0.5 text-xl font-bold text-teal-700 tabular-nums">{fmt(supplierPaymentTotal)}</p>
        </div>
        <div className="rounded-lg border border-purple-100 bg-purple-50 p-3 shadow-sm">
          <p className="text-xs text-purple-700">คืนเงินลูกค้า (CN)</p>
          <p className="mt-0.5 text-xl font-bold text-purple-700 tabular-nums">{fmt(cnRefundTotal)}</p>
        </div>
      </div>

      {!filters.hasFilter ? (
        <div className="rounded-xl border border-gray-100 bg-white p-12 text-center shadow-sm">
          <p className="text-gray-400">เลือกช่วงวันที่แล้วกด &ldquo;แสดงรายการ&rdquo; เพื่อดูข้อมูล</p>
        </div>
      ) : (
      <>
      <p className="text-sm text-gray-500">
        แสดง <span className="font-semibold text-gray-900">{rows.length}</span> รายการ
        {rows.length >= 2000 && " (จำกัด 2,000 รายการ)"}
      </p>

      <ReportTableShell>
          <thead className="bg-[#1e3a5f] text-white">
            <tr>
              <th className="w-10 px-3 py-2.5 text-center font-medium">#</th>
              <th className="px-3 py-2.5 text-left font-medium">เลขที่เอกสาร</th>
              <th className="px-3 py-2.5 text-left font-medium">วันที่</th>
              <th className="px-3 py-2.5 text-left font-medium">ประเภทรายการ</th>
              <th className="px-3 py-2.5 text-left font-medium">รหัสคู่ค้า</th>
              <th className="px-3 py-2.5 text-left font-medium">ชื่อคู่ค้า / รายละเอียด</th>
              <th className="px-3 py-2.5 text-left font-medium">ช่องทางชำระ</th>
              <th className="px-3 py-2.5 text-left font-medium">Account</th>
              <th className="px-3 py-2.5 text-left font-medium">หมายเหตุ</th>
              <th className="px-3 py-2.5 text-center font-medium">สถานะ</th>
              <th className="px-3 py-2.5 text-right font-medium">จำนวนเงิน</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-gray-400">
                  ไม่พบข้อมูลในช่วงวันที่ที่เลือก
                </td>
              </tr>
            )}
            {rows.map((row: DailyPaymentRow) => (
              <tr
                key={`${row.docNo}-${row.rowNo}`}
                className={`transition-colors ${getAdminReportRowClass(row.status === "CANCELLED")}`}
              >
                <td className="px-3 py-2 text-center text-gray-400 tabular-nums">{row.rowNo}</td>
                <td className="px-3 py-2 font-mono text-xs font-medium text-[#1e3a5f]">{row.docNo}</td>
                <td className="whitespace-nowrap px-3 py-2">{fmtDate(row.docDate)}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${DOC_TYPE_COLORS[row.docType] ?? "bg-gray-100 text-gray-600 dark:bg-slate-600/40 dark:text-slate-200"}`}>
                    {row.docType}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{row.partyCode}</td>
                <td className="px-3 py-2">{row.partyName}</td>
                <td className="px-3 py-2">
                  {row.paymentMethod !== "-" ? (
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${PM_COLORS[row.paymentMethod] ?? "bg-gray-100 text-gray-600 dark:bg-slate-600/40 dark:text-slate-200"}`}>
                      {row.paymentMethod}
                    </span>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-600">{row.accountName}</td>
                <td className="max-w-[160px] truncate px-3 py-2 text-gray-500">{row.note}</td>
                <td className="px-3 py-2 text-center">
                  <AdminStatusBadge tone={row.status === "ACTIVE" ? "success" : "danger"}>
                    {statusLabel(row.status)}
                  </AdminStatusBadge>
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{fmt(row.amount)}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-gray-200 bg-gray-50">
              <tr>
                <td colSpan={10} className="px-3 py-2.5 text-right text-sm font-semibold text-gray-700">
                  รวมทั้งสิ้น (รวมที่ยกเลิก)
                </td>
                <td className="px-3 py-2.5 text-right font-bold text-[#1e3a5f] tabular-nums">
                  {fmt(rows.reduce((s, r) => s + r.amount, 0))}
                </td>
              </tr>
            </tfoot>
          )}
      </ReportTableShell>
      </>
      )}
    </div>
  );
}
