export const dynamic = "force-dynamic";

import Link from "next/link";
import { FileSpreadsheet, FileText } from "lucide-react";
import { requirePermission } from "@/lib/require-auth";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import {
  parseCashBankReportFilters,
  queryCashBankLedgerData,
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
  if (filters.sourceType !== "ALL") params.set("sourceType", filters.sourceType);
  return params.toString();
}

export default async function CashBankLedgerReportPage({ searchParams }: PageProps) {
  await requirePermission("reports.view");
  const params = await searchParams;
  const filters = parseCashBankReportFilters(params);

  const [accounts, ledger] = await Promise.all([
    getActiveCashBankAccountOptions(),
    queryCashBankLedgerData(filters),
  ]);

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
            <option value="TRANSFER">TRANSFER</option>
            <option value="ADJUSTMENT">ADJUSTMENT</option>
          </select>
        </label>
        <button
          type="submit"
          className="h-9 rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055]"
        >
          แสดงรายงาน
        </button>
        <Link
          href="/admin/reports/cash-bank-ledger"
          className="inline-flex h-9 items-center rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200"
        >
          ล้าง
        </Link>
        <div className="ml-auto flex gap-2">
          <Link
            href={`/admin/reports/export?type=cash-bank-ledger&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-gray-600 px-3 text-sm font-medium text-white hover:bg-gray-700"
          >
            <FileText size={14} />
            CSV
          </Link>
          <Link
            href={`/admin/reports/export-excel?type=cash-bank-ledger&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-3 text-sm font-medium text-white hover:bg-green-700"
          >
            <FileSpreadsheet size={14} />
            Excel
          </Link>
        </div>
      </form>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-gray-100 bg-white p-3 shadow-sm">
          <p className="text-xs text-gray-500">ยอดยกมา</p>
          <p className="mt-0.5 font-kanit text-xl font-bold text-[#1e3a5f]">
            {formatCurrency(ledger.openingBalance)}
          </p>
        </div>
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 shadow-sm">
          <p className="text-xs text-emerald-700">รวมรับ</p>
          <p className="mt-0.5 font-kanit text-xl font-bold text-emerald-700">
            {formatCurrency(ledger.totalIn)}
          </p>
        </div>
        <div className="rounded-lg border border-rose-100 bg-rose-50 p-3 shadow-sm">
          <p className="text-xs text-rose-700">รวมจ่าย</p>
          <p className="mt-0.5 font-kanit text-xl font-bold text-rose-700">
            {formatCurrency(ledger.totalOut)}
          </p>
        </div>
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 shadow-sm">
          <p className="text-xs text-blue-700">ยอดคงเหลือปลายงวด</p>
          <p className="mt-0.5 font-kanit text-xl font-bold text-blue-700">
            {formatCurrency(ledger.endingBalance)}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-[#1e3a5f] text-white">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium">วันที่</th>
              <th className="px-3 py-2.5 text-left font-medium">บัญชี</th>
              <th className="px-3 py-2.5 text-left font-medium">เลขอ้างอิง</th>
              <th className="px-3 py-2.5 text-left font-medium">Source</th>
              <th className="px-3 py-2.5 text-left font-medium">เอกสารต้นทาง</th>
              <th className="px-3 py-2.5 text-left font-medium">หมายเหตุ</th>
              <th className="px-3 py-2.5 text-right font-medium">รับเข้า</th>
              <th className="px-3 py-2.5 text-right font-medium">จ่ายออก</th>
              <th className="px-3 py-2.5 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {ledger.rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-gray-400">
                  ไม่พบข้อมูลตามเงื่อนไขที่เลือก
                </td>
              </tr>
            ) : (
              ledger.rows.map((row) => (
                <tr key={`${row.accountId}-${row.rowNo}`} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-3 py-2">{formatDate(row.txnDate)}</td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-900">{row.accountName}</p>
                    <p className="text-xs text-gray-400">{row.accountCode}</p>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f]">{row.referenceNo}</td>
                  <td className="px-3 py-2">
                    <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      {row.sourceLabel}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {row.sourceHref ? (
                      <Link href={row.sourceHref} className="font-medium text-[#1e3a5f] hover:underline">
                        เปิดเอกสาร
                      </Link>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-gray-500">{row.note || "-"}</td>
                  <td className="px-3 py-2 text-right font-medium text-emerald-700">
                    {row.inAmount > 0 ? formatCurrency(row.inAmount) : "-"}
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-rose-700">
                    {row.outAmount > 0 ? formatCurrency(row.outAmount) : "-"}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {formatCurrency(row.balanceAfter)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
