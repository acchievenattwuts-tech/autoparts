import ReportTableShell from "@/components/shared/ReportTableShell";
import { getAdminReportRowClass } from "@/lib/admin-status-presentation";
import {
  queryDailyReceiptRows,
  statusLabel,
  type DailyReceiptRow,
  type ReportFilters,
} from "@/lib/report-queries";
import { formatDateThai } from "@/lib/th-date";

/**
 * The awaited half of the daily receipt report. Both the summary cards and the
 * table come from queryDailyReceiptRows, so they stream together.
 */

const ROW_LIMIT = 2000;

function fmt(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const DOC_TYPE_COLORS: Record<string, string> = {
  "ขายสด": "bg-green-100 text-green-700",
  "รับชำระหนี้": "bg-blue-100 text-blue-700",
  "รับเงินมัดจำลูกค้า": "bg-amber-100 text-amber-700",
};

const PM_COLORS: Record<string, string> = {
  "เงินสด": "bg-emerald-100 text-emerald-700",
  "โอนเงิน": "bg-sky-100 text-sky-700",
  "เครดิต": "bg-purple-100 text-purple-700",
};

export type ReceiptSummaryTotals = {
  total: number;
  cashSale: number;
  receipt: number;
  customerAdvance: number;
};

export const EMPTY_RECEIPT_TOTALS: ReceiptSummaryTotals = {
  total: 0,
  cashSale: 0,
  receipt: 0,
  customerAdvance: 0,
};

const sumActiveByDocType = (rows: DailyReceiptRow[], docType?: string): number =>
  rows
    .filter((row) => row.status === "ACTIVE" && (docType === undefined || row.docType === docType))
    .reduce((sum, row) => sum + row.amount, 0);

/** Shared by the loaded report and the "no filter yet" state, which shows zeros. */
export const ReceiptSummaryCards = ({ totals }: { totals: ReceiptSummaryTotals }) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <div className="rounded-lg border border-gray-100 bg-white p-3 shadow-sm">
      <p className="text-xs text-gray-500">รวมรับเงิน (เฉพาะที่ใช้งาน)</p>
      <p className="mt-0.5 text-xl font-bold text-[#1e3a5f] tabular-nums">{fmt(totals.total)}</p>
    </div>
    <div className="rounded-lg border border-green-100 bg-green-50 p-3 shadow-sm">
      <p className="text-xs text-green-700">ขายสด</p>
      <p className="mt-0.5 text-xl font-bold text-green-700 tabular-nums">{fmt(totals.cashSale)}</p>
    </div>
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 shadow-sm">
      <p className="text-xs text-blue-700">รับชำระหนี้</p>
      <p className="mt-0.5 text-xl font-bold text-blue-700 tabular-nums">{fmt(totals.receipt)}</p>
    </div>
    <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 shadow-sm">
      <p className="text-xs text-amber-700">รับเงินมัดจำลูกค้า</p>
      <p className="mt-0.5 text-xl font-bold text-amber-700 tabular-nums">{fmt(totals.customerAdvance)}</p>
    </div>
  </div>
);

export default async function ReceiptsReportResults({ filters }: { filters: ReportFilters }) {
  const rows = await queryDailyReceiptRows(filters);

  const totals: ReceiptSummaryTotals = {
    total: sumActiveByDocType(rows),
    cashSale: sumActiveByDocType(rows, "ขายสด"),
    receipt: sumActiveByDocType(rows, "รับชำระหนี้"),
    customerAdvance: sumActiveByDocType(rows, "รับเงินมัดจำลูกค้า"),
  };

  return (
    <>
      <ReceiptSummaryCards totals={totals} />

      <p className="text-sm text-gray-500">
        แสดง <span className="font-semibold text-gray-900">{rows.length}</span> รายการ
        {rows.length >= ROW_LIMIT && " (จำกัด 2,000 รายการ)"}
      </p>

      <ReportTableShell>
        <thead className="bg-[#1e3a5f] text-white">
          <tr>
            <th className="w-10 px-3 py-2.5 text-center font-medium">#</th>
            <th className="px-3 py-2.5 text-left font-medium">เลขที่เอกสาร</th>
            <th className="px-3 py-2.5 text-left font-medium">วันที่</th>
            <th className="px-3 py-2.5 text-left font-medium">ประเภท</th>
            <th className="px-3 py-2.5 text-left font-medium">รหัสลูกค้า</th>
            <th className="px-3 py-2.5 text-left font-medium">ชื่อลูกค้า</th>
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
          {rows.map((row: DailyReceiptRow) => (
            <tr
              key={`${row.docNo}-${row.rowNo}`}
              className={`transition-colors ${getAdminReportRowClass(row.status === "CANCELLED")}`}
            >
              <td className="px-3 py-2 text-center text-gray-400 tabular-nums">{row.rowNo}</td>
              <td className="px-3 py-2 font-mono text-xs font-medium text-[#1e3a5f]">{row.docNo}</td>
              <td className="whitespace-nowrap px-3 py-2">{formatDateThai(row.docDate)}</td>
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
                {fmt(rows.reduce((sum, row) => sum + row.amount, 0))}
              </td>
            </tr>
          </tfoot>
        )}
      </ReportTableShell>
    </>
  );
}
