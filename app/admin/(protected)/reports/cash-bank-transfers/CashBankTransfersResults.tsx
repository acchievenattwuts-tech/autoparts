import { getAdminReportRowClass } from "@/lib/admin-status-presentation";
import {
  CASH_BANK_HISTORY_ROW_LIMIT,
  queryCashBankTransferHistoryRows,
  type CashBankReportFilters,
} from "@/lib/cash-bank-report-queries";
import { formatDateThai } from "@/lib/th-date";

/** The awaited half of the cash/bank transfer history. */

function formatDate(value: Date): string {
  return formatDateThai(value);
}

function formatCurrency(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default async function CashBankTransfersResults({
  filters,
}: {
  filters: CashBankReportFilters;
}) {
  const rows = await queryCashBankTransferHistoryRows(filters);

  const activeRows = rows.filter((row) => row.status === "ACTIVE");
  const totalAmount = activeRows.reduce((sum, row) => sum + row.amount, 0);
  const rowLimitReached = rows.length >= CASH_BANK_HISTORY_ROW_LIMIT;

  return (
    <>
      {rowLimitReached ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300">
          รายการบนหน้านี้แสดงสูงสุด {CASH_BANK_HISTORY_ROW_LIMIT.toLocaleString("th-TH")} แถว กรุณาลดช่วงวันที่ถ้าต้องการดูรายละเอียดทั้งหมด
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-gray-100 bg-white p-3 shadow-sm">
          <p className="text-xs text-gray-500">จำนวนรายการ</p>
          <p className="mt-0.5 font-kanit text-xl font-bold text-[#1e3a5f]">{rows.length}</p>
        </div>
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 shadow-sm">
          <p className="text-xs text-blue-700">รายการใช้งานอยู่</p>
          <p className="mt-0.5 font-kanit text-xl font-bold text-blue-700">{activeRows.length}</p>
        </div>
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 shadow-sm">
          <p className="text-xs text-emerald-700">ยอดโอนรวม</p>
          <p className="mt-0.5 font-kanit text-xl font-bold text-emerald-700">
            {formatCurrency(totalAmount)}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-[#1e3a5f] text-white">
            <tr>
              <th className="px-3 py-2.5 text-center font-medium">#</th>
              <th className="px-3 py-2.5 text-left font-medium">เลขที่โอน</th>
              <th className="px-3 py-2.5 text-left font-medium">วันที่</th>
              <th className="px-3 py-2.5 text-left font-medium">บัญชีต้นทาง</th>
              <th className="px-3 py-2.5 text-left font-medium">บัญชีปลายทาง</th>
              <th className="px-3 py-2.5 text-left font-medium">หมายเหตุ</th>
              <th className="px-3 py-2.5 text-center font-medium">สถานะ</th>
              <th className="px-3 py-2.5 text-right font-medium">จำนวนเงิน</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                  ไม่พบรายการโอนเงินตามเงื่อนไขที่เลือก
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className={`${getAdminReportRowClass(row.status === "CANCELLED")}`}
                >
                  <td className="px-3 py-2 text-center text-gray-400">{row.rowNo}</td>
                  <td className="px-3 py-2 font-mono text-xs font-medium text-[#1e3a5f]">{row.transferNo}</td>
                  <td className="whitespace-nowrap px-3 py-2">{formatDate(row.transferDate)}</td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-900">{row.fromAccountName}</p>
                    <p className="text-xs text-gray-400">{row.fromAccountCode}</p>
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-900">{row.toAccountName}</p>
                    <p className="text-xs text-gray-400">{row.toAccountCode}</p>
                  </td>
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
  );
}
