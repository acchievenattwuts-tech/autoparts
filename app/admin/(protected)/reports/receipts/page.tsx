export const dynamic = "force-dynamic";

import Link from "next/link";
import { FileSpreadsheet, FileText } from "lucide-react";
import { requirePermission } from "@/lib/require-auth";
import { db } from "@/lib/db";
import {
  parseReportQueryFilters,
  queryDailyReceiptRows,
  buildExportQuery,
  statusLabel,
  type DailyReceiptRow,
} from "@/lib/report-queries";

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

function fmt(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: Date) {
  return d.toLocaleDateString("th-TH-u-ca-gregory", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const DOC_TYPE_COLORS: Record<string, string> = {
  "à¸‚à¸²à¸¢à¸ªà¸”": "bg-green-100 text-green-700",
  "à¸£à¸±à¸šà¸Šà¸³à¸£à¸°à¸«à¸™à¸µà¹‰": "bg-blue-100 text-blue-700",
};

const PM_COLORS: Record<string, string> = {
  "à¹€à¸‡à¸´à¸™à¸ªà¸”": "bg-emerald-100 text-emerald-700",
  "à¹‚à¸­à¸™à¹€à¸‡à¸´à¸™": "bg-sky-100 text-sky-700",
  "à¹€à¸„à¸£à¸”à¸´à¸•": "bg-purple-100 text-purple-700",
};

export default async function DailyReceiptPage({ searchParams }: PageProps) {
  await requirePermission("reports.view");
  const params = await searchParams;
  const filters = parseReportQueryFilters(params);
  const [rows, accounts] = await Promise.all([
    queryDailyReceiptRows(filters),
    db.cashBankAccount.findMany({
      where: { isActive: true },
      orderBy: [{ type: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true },
    }),
  ]);

  const totalAmount = rows.filter((r) => r.status === "ACTIVE").reduce((s, r) => s + r.amount, 0);
  const cashSaleTotal = rows
    .filter((r) => r.docType === "à¸‚à¸²à¸¢à¸ªà¸”" && r.status === "ACTIVE")
    .reduce((s, r) => s + r.amount, 0);
  const receiptTotal = rows
    .filter((r) => r.docType === "à¸£à¸±à¸šà¸Šà¸³à¸£à¸°à¸«à¸™à¸µà¹‰" && r.status === "ACTIVE")
    .reduce((s, r) => s + r.amount, 0);
  const exportQuery = buildExportQuery(filters);

  return (
    <div className="space-y-4">
      <form method="GET" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          à¸•à¸±à¹‰à¸‡à¹à¸•à¹ˆà¸§à¸±à¸™à¸—à¸µà¹ˆ
          <input
            type="date"
            name="from"
            defaultValue={filters.fromStr}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          à¸–à¸¶à¸‡à¸§à¸±à¸™à¸—à¸µà¹ˆ
          <input
            type="date"
            name="to"
            defaultValue={filters.toStr}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          à¸›à¸£à¸°à¹€à¸ à¸—à¹€à¸­à¸à¸ªà¸²à¸£
          <select
            name="docType"
            defaultValue={filters.docType ?? "ALL"}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="ALL">à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”</option>
            <option value="CASH_SALE">à¸‚à¸²à¸¢à¸ªà¸”</option>
            <option value="RECEIPT">à¸£à¸±à¸šà¸Šà¸³à¸£à¸°à¸«à¸™à¸µà¹‰</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Account
          <select
            name="accountId"
            defaultValue={filters.accountId ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Ã Â¸â€”Ã Â¸Â±Ã Â¹â€°Ã Â¸â€¡Ã Â¸Â«Ã Â¸Â¡Ã Â¸â€</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} - {account.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mb-1 flex items-center gap-2 self-end text-sm text-gray-600">
          <input
            type="checkbox"
            name="showCancelled"
            value="1"
            defaultChecked={filters.showCancelled}
            className="h-4 w-4 rounded border-gray-300"
          />
          à¸£à¸§à¸¡à¸—à¸µà¹ˆà¸¢à¸à¹€à¸¥à¸´à¸
        </label>
        <button
          type="submit"
          className="h-9 self-end rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055]"
        >
          à¹à¸ªà¸”à¸‡à¸£à¸²à¸¢à¸‡à¸²à¸™
        </button>
        <Link
          href="/admin/reports/receipts"
          className="inline-flex h-9 items-center self-end rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200"
        >
          à¸¥à¹‰à¸²à¸‡
        </Link>
        <div className="ml-auto flex gap-2 self-end">
          <Link
            href={`/admin/reports/export?type=daily-receipt&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-gray-600 px-3 text-sm font-medium text-white hover:bg-gray-700"
          >
            <FileText size={14} />
            CSV
          </Link>
          <Link
            href={`/admin/reports/export-excel?type=daily-receipt&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-3 text-sm font-medium text-white hover:bg-green-700"
          >
            <FileSpreadsheet size={14} />
            Excel
          </Link>
        </div>
      </form>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-gray-100 bg-white p-3 shadow-sm">
          <p className="text-xs text-gray-500">à¸£à¸§à¸¡à¸£à¸±à¸šà¹€à¸‡à¸´à¸™ (à¹€à¸‰à¸žà¸²à¸°à¸—à¸µà¹ˆà¹ƒà¸Šà¹‰à¸‡à¸²à¸™)</p>
          <p className="mt-0.5 text-xl font-bold text-[#1e3a5f] tabular-nums">{fmt(totalAmount)}</p>
        </div>
        <div className="rounded-lg border border-green-100 bg-green-50 p-3 shadow-sm">
          <p className="text-xs text-green-700">à¸‚à¸²à¸¢à¸ªà¸”</p>
          <p className="mt-0.5 text-xl font-bold text-green-700 tabular-nums">{fmt(cashSaleTotal)}</p>
        </div>
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 shadow-sm">
          <p className="text-xs text-blue-700">à¸£à¸±à¸šà¸Šà¸³à¸£à¸°à¸«à¸™à¸µà¹‰</p>
          <p className="mt-0.5 text-xl font-bold text-blue-700 tabular-nums">{fmt(receiptTotal)}</p>
        </div>
      </div>

      <p className="text-sm text-gray-500">
        à¹à¸ªà¸”à¸‡ <span className="font-semibold text-gray-900">{rows.length}</span> à¸£à¸²à¸¢à¸à¸²à¸£
        {rows.length >= 2000 && " (à¸ˆà¸³à¸à¸±à¸” 2,000 à¸£à¸²à¸¢à¸à¸²à¸£)"}
      </p>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-[#1e3a5f] text-white">
            <tr>
              <th className="w-10 px-3 py-2.5 text-center font-medium">#</th>
              <th className="px-3 py-2.5 text-left font-medium">à¹€à¸¥à¸‚à¸—à¸µà¹ˆà¹€à¸­à¸à¸ªà¸²à¸£</th>
              <th className="px-3 py-2.5 text-left font-medium">à¸§à¸±à¸™à¸—à¸µà¹ˆ</th>
              <th className="px-3 py-2.5 text-left font-medium">à¸›à¸£à¸°à¹€à¸ à¸—</th>
              <th className="px-3 py-2.5 text-left font-medium">à¸£à¸«à¸±à¸ªà¸¥à¸¹à¸à¸„à¹‰à¸²</th>
              <th className="px-3 py-2.5 text-left font-medium">à¸Šà¸·à¹ˆà¸­à¸¥à¸¹à¸à¸„à¹‰à¸²</th>
              <th className="px-3 py-2.5 text-left font-medium">à¸Šà¹ˆà¸­à¸‡à¸—à¸²à¸‡à¸Šà¸³à¸£à¸°</th>
              <th className="px-3 py-2.5 text-left font-medium">Account</th>
              <th className="px-3 py-2.5 text-left font-medium">à¸«à¸¡à¸²à¸¢à¹€à¸«à¸•à¸¸</th>
              <th className="px-3 py-2.5 text-center font-medium">à¸ªà¸–à¸²à¸™à¸°</th>
              <th className="px-3 py-2.5 text-right font-medium">à¸ˆà¸³à¸™à¸§à¸™à¹€à¸‡à¸´à¸™</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-gray-400">
                  à¹„à¸¡à¹ˆà¸žà¸šà¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹ƒà¸™à¸Šà¹ˆà¸§à¸‡à¸§à¸±à¸™à¸—à¸µà¹ˆà¸—à¸µà¹ˆà¹€à¸¥à¸·à¸­à¸
                </td>
              </tr>
            )}
            {rows.map((row: DailyReceiptRow) => (
              <tr
                key={`${row.docNo}-${row.rowNo}`}
                className={`transition-colors hover:bg-gray-50 ${row.status === "CANCELLED" ? "opacity-50 line-through" : ""}`}
              >
                <td className="px-3 py-2 text-center text-gray-400 tabular-nums">{row.rowNo}</td>
                <td className="px-3 py-2 font-mono text-xs font-medium text-[#1e3a5f]">{row.docNo}</td>
                <td className="whitespace-nowrap px-3 py-2">{fmtDate(row.docDate)}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${DOC_TYPE_COLORS[row.docType] ?? "bg-gray-100 text-gray-600"}`}>
                    {row.docType}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{row.customerCode}</td>
                <td className="px-3 py-2">{row.customerName}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${PM_COLORS[row.paymentMethod] ?? "bg-gray-100 text-gray-600"}`}>
                    {row.paymentMethod}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-600">{row.accountName}</td>
                <td className="max-w-[160px] truncate px-3 py-2 text-gray-500">{row.note}</td>
                <td className="px-3 py-2 text-center">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      row.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                    }`}
                  >
                    {statusLabel(row.status)}
                  </span>
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
        </table>
      </div>
    </div>
  );
}
