import { getAdminReportRowClass } from "@/lib/admin-status-presentation";
import { CashBankDirection } from "@/lib/generated/prisma";
import {
  CASH_BANK_HISTORY_ROW_LIMIT,
  queryCashBankAdjustmentHistoryRows,
  type CashBankReportFilters,
} from "@/lib/cash-bank-report-queries";
import { formatDateThai } from "@/lib/th-date";

/** The awaited half of the cash/bank adjustment history. */

function formatDate(value: Date): string {
  return formatDateThai(value);
}

function formatCurrency(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default async function CashBankAdjustmentsResults({
  filters,
}: {
  filters: CashBankReportFilters;
}) {
  const rows = await queryCashBankAdjustmentHistoryRows(filters);

  const activeRows = rows.filter((row) => row.status === "ACTIVE");
  const totalIn = activeRows
    .filter((row) => row.direction === CashBankDirection.IN)
    .reduce((sum, row) => sum + row.amount, 0);
  const totalOut = activeRows
    .filter((row) => row.direction === CashBankDirection.OUT)
    .reduce((sum, row) => sum + row.amount, 0);
  const rowLimitReached = rows.length >= CASH_BANK_HISTORY_ROW_LIMIT;

  return (
    <>
      {rowLimitReached ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300">
          รายการบนหน้านี้แสดงสูงสุด {CASH_BANK_HISTORY_ROW_LIMIT.toLocaleString("th-TH")} แถว กรุณาลดช่วงวันที่ถ้าต้องการดูรายละเอียดทั้งหมด
        </div>
      ) : null}
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
                  className={`${getAdminReportRowClass(row.status === "CANCELLED")}`}
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
  );
}
