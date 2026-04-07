export const dynamic = "force-dynamic";

import Link from "next/link";
import { FileSpreadsheet, FileText } from "lucide-react";
import { requirePermission } from "@/lib/require-auth";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import { CashBankDirection } from "@/lib/generated/prisma";
import {
  parseCashBankReportFilters,
  queryCashBankAdjustmentHistoryRows,
} from "@/lib/cash-bank-report-queries";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

function formatDate(value: Date): string {
  return value.toLocaleDateString("th-TH-u-ca-gregory", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatCurrency(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildQuery(filters: ReturnType<typeof parseCashBankReportFilters>): string {
  const params = new URLSearchParams();
  params.set("from", filters.fromStr);
  params.set("to", filters.toStr);
  if (filters.accountId) params.set("accountId", filters.accountId);
  if (filters.direction !== "ALL") params.set("direction", filters.direction);
  if (filters.showCancelled) params.set("showCancelled", "1");
  return params.toString();
}

export default async function CashBankAdjustmentHistoryReportPage({ searchParams }: PageProps) {
  await requirePermission("reports.view");
  const params = await searchParams;
  const filters = parseCashBankReportFilters(params);

  const [accounts, rows] = await Promise.all([
    getActiveCashBankAccountOptions(),
    filters.hasFilter ? queryCashBankAdjustmentHistoryRows(filters) : Promise.resolve([]),
  ]);

  const activeRows = rows.filter((row) => row.status === "ACTIVE");
  const totalIn = activeRows
    .filter((row) => row.direction === CashBankDirection.IN)
    .reduce((sum, row) => sum + row.amount, 0);
  const totalOut = activeRows
    .filter((row) => row.direction === CashBankDirection.OUT)
    .reduce((sum, row) => sum + row.amount, 0);
  const exportQuery = buildQuery(filters);

  return (
    <div className="space-y-4">
      <form method="GET" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          บัญชี
          <select
            name="accountId"
            defaultValue={filters.accountId ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">ทุกบัญชี</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} - {account.name}
              </option>
            ))}
          </select>
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
          ทิศทาง
          <select
            name="direction"
            defaultValue={filters.direction}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="ALL">ทั้งหมด</option>
            <option value="IN">IN</option>
            <option value="OUT">OUT</option>
          </select>
        </label>
        <label className="mb-1 flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            name="showCancelled"
            value="1"
            defaultChecked={filters.showCancelled}
            className="h-4 w-4 rounded border-gray-300"
          />
          รวมรายการยกเลิก
        </label>
        <button
          type="submit"
          className="h-9 rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055]"
        >
          แสดงรายงาน
        </button>
        <Link
          href="/admin/reports/cash-bank-adjustments"
          className="inline-flex h-9 items-center rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200"
        >
          ล้าง
        </Link>
        <div className="ml-auto flex gap-2">
          <Link
            href={`/admin/reports/export?type=cash-bank-adjustments&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-gray-600 px-3 text-sm font-medium text-white hover:bg-gray-700"
          >
            <FileText size={14} />
            CSV
          </Link>
          <Link
            href={`/admin/reports/export-excel?type=cash-bank-adjustments&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-3 text-sm font-medium text-white hover:bg-green-700"
          >
            <FileSpreadsheet size={14} />
            Excel
          </Link>
        </div>
      </form>

      {!filters.hasFilter ? (
        <div className="rounded-xl border border-gray-100 bg-white p-12 text-center shadow-sm">
          <p className="text-gray-400">เลือกช่วงวันที่แล้วกด &ldquo;แสดงรายการ&rdquo; เพื่อดูข้อมูล</p>
        </div>
      ) : (
      <>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 shadow-sm">
          <p className="text-xs text-emerald-700">Adjustment เงินเข้า</p>
          <p className="mt-0.5 font-kanit text-xl font-bold text-emerald-700">
            {formatCurrency(totalIn)}
          </p>
        </div>
        <div className="rounded-lg border border-rose-100 bg-rose-50 p-3 shadow-sm">
          <p className="text-xs text-rose-700">Adjustment เงินออก</p>
          <p className="mt-0.5 font-kanit text-xl font-bold text-rose-700">
            {formatCurrency(totalOut)}
          </p>
        </div>
        <div className="rounded-lg border border-gray-100 bg-white p-3 shadow-sm">
          <p className="text-xs text-gray-500">จำนวนรายการ</p>
          <p className="mt-0.5 font-kanit text-xl font-bold text-[#1e3a5f]">{rows.length}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-[#1e3a5f] text-white">
            <tr>
              <th className="px-3 py-2.5 text-center font-medium">#</th>
              <th className="px-3 py-2.5 text-left font-medium">เลขที่ปรับยอด</th>
              <th className="px-3 py-2.5 text-left font-medium">วันที่</th>
              <th className="px-3 py-2.5 text-left font-medium">บัญชี</th>
              <th className="px-3 py-2.5 text-left font-medium">ทิศทาง</th>
              <th className="px-3 py-2.5 text-left font-medium">เหตุผล</th>
              <th className="px-3 py-2.5 text-left font-medium">หมายเหตุ</th>
              <th className="px-3 py-2.5 text-center font-medium">สถานะ</th>
              <th className="px-3 py-2.5 text-right font-medium">จำนวนเงิน</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-gray-400">
                  ไม่พบรายการปรับยอดตามเงื่อนไขที่เลือก
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className={`hover:bg-gray-50 ${row.status === "CANCELLED" ? "opacity-60 line-through" : ""}`}
                >
                  <td className="px-3 py-2 text-center text-gray-400">{row.rowNo}</td>
                  <td className="px-3 py-2 font-mono text-xs font-medium text-[#1e3a5f]">{row.adjustNo}</td>
                  <td className="whitespace-nowrap px-3 py-2">{formatDate(row.adjustDate)}</td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-900">{row.accountName}</p>
                    <p className="text-xs text-gray-400">{row.accountCode}</p>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.direction === "IN" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {row.direction}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-700">{row.reason}</td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-gray-500">
                    {row.status === "CANCELLED" && row.cancelNote ? row.cancelNote : row.note || "-"}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {formatCurrency(row.amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </>
      )}
    </div>
  );
}
