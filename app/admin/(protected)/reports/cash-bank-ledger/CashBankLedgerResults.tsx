import Link from "next/link";

import {
  queryCashBankLedgerData,
  type CashBankReportFilters,
} from "@/lib/cash-bank-report-queries";
import { formatDateThai } from "@/lib/th-date";

/**
 * The awaited half of the cash/bank ledger (p50 ~175ms over 313 rows).
 * The row-limit notice and the four balance cards all come from the same
 * query result, so they stream together with the table.
 */

function formatCurrency(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default async function CashBankLedgerResults({
  filters,
}: {
  filters: CashBankReportFilters;
}) {
  const ledger = await queryCashBankLedgerData(filters);

  return (
    <>
      {ledger.rowLimitReached ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
          แสดงข้อมูลสูงสุด {ledger.rowLimit.toLocaleString("th-TH")} รายการ กรุณาลดช่วงวันที่หรือเลือกบัญชีเพื่อดูข้อมูลให้ครบก่อน export
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-gray-100 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
          <p className="text-xs text-gray-500 dark:text-slate-400">ยอดยกมา</p>
          <p className="mt-0.5 font-kanit text-xl font-bold text-[#1e3a5f] dark:text-sky-300">
            {formatCurrency(ledger.openingBalance)}
          </p>
        </div>
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 shadow-sm dark:border-emerald-400/20 dark:bg-emerald-400/10">
          <p className="text-xs text-emerald-700 dark:text-emerald-300">รวมรับ</p>
          <p className="mt-0.5 font-kanit text-xl font-bold text-emerald-700 dark:text-emerald-300">
            {formatCurrency(ledger.totalIn)}
          </p>
        </div>
        <div className="rounded-lg border border-rose-100 bg-rose-50 p-3 shadow-sm dark:border-rose-400/20 dark:bg-rose-400/10">
          <p className="text-xs text-rose-700 dark:text-rose-300">รวมจ่าย</p>
          <p className="mt-0.5 font-kanit text-xl font-bold text-rose-700 dark:text-rose-300">
            {formatCurrency(ledger.totalOut)}
          </p>
        </div>
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 shadow-sm dark:border-sky-400/20 dark:bg-sky-400/10">
          <p className="text-xs text-blue-700 dark:text-sky-300">ยอดคงเหลือปลายงวด</p>
          <p className="mt-0.5 font-kanit text-xl font-bold text-blue-700 dark:text-sky-300">
            {formatCurrency(ledger.endingBalance)}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-white/10">
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
          <tbody className="divide-y divide-gray-100 dark:divide-white/10">
            {ledger.rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-gray-400">
                  ไม่พบข้อมูลตามเงื่อนไขที่เลือก
                </td>
              </tr>
            ) : (
              ledger.rows.map((row) => (
                <tr key={`${row.accountId}-${row.rowNo}`} className="hover:bg-gray-50 dark:hover:bg-white/5">
                  <td className="whitespace-nowrap px-3 py-2 dark:text-slate-300">{formatDateThai(row.txnDate)}</td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-900 dark:text-slate-100">{row.accountName}</p>
                    <p className="text-xs text-gray-400 dark:text-slate-500">{row.accountCode}</p>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f] dark:text-sky-300">{row.referenceNo}</td>
                  <td className="px-3 py-2">
                    <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/10 dark:text-slate-300">
                      {row.sourceLabel}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {row.sourceHref ? (
                      <Link href={row.sourceHref} className="font-medium text-[#1e3a5f] hover:underline dark:text-sky-300">
                        เปิดเอกสาร
                      </Link>
                    ) : (
                      <span className="text-gray-400 dark:text-slate-500">-</span>
                    )}
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-gray-500 dark:text-slate-400">{row.note || "-"}</td>
                  <td className="px-3 py-2 text-right font-medium text-emerald-700 dark:text-emerald-300">
                    {row.inAmount > 0 ? formatCurrency(row.inAmount) : "-"}
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-rose-700 dark:text-rose-300">
                    {row.outAmount > 0 ? formatCurrency(row.outAmount) : "-"}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums dark:text-slate-100">
                    {formatCurrency(row.balanceAfter)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
