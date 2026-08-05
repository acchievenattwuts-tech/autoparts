import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import ReportTableShell from "@/components/shared/ReportTableShell";
import { getAdminReportRowClass } from "@/lib/admin-status-presentation";
import {
  queryDailyPaymentRows,
  statusLabel,
  type DailyPaymentRow,
  type ReportFilters,
} from "@/lib/report-queries";
import { formatDateThai } from "@/lib/th-date";

/**
 * The awaited half of the daily payment report.
 *
 * queryDailyPaymentRows is the slowest query on any report page (p50 ~483ms
 * over 90 days) and both the summary cards and the table are derived from it,
 * so the whole block streams behind one Suspense boundary.
 */

const ROW_LIMIT = 2000;

function fmt(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

export type PaymentSummaryTotals = {
  total: number;
  purchase: number;
  expense: number;
  supplierAdvance: number;
  supplierPayment: number;
  cnRefund: number;
};

export const EMPTY_PAYMENT_TOTALS: PaymentSummaryTotals = {
  total: 0,
  purchase: 0,
  expense: 0,
  supplierAdvance: 0,
  supplierPayment: 0,
  cnRefund: 0,
};

const sumActiveByDocType = (rows: DailyPaymentRow[], docType?: string): number =>
  rows
    .filter((row) => row.status === "ACTIVE" && (docType === undefined || row.docType === docType))
    .reduce((sum, row) => sum + row.amount, 0);

/** Shared by the loaded report and the "no filter yet" state, which shows zeros. */
export const PaymentSummaryCards = ({ totals }: { totals: PaymentSummaryTotals }) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
    <div className="rounded-lg border border-gray-100 bg-white p-3 shadow-sm">
      <p className="text-xs text-gray-500">รวมจ่ายเงิน (เฉพาะที่ใช้งาน)</p>
      <p className="mt-0.5 text-xl font-bold text-[#1e3a5f] tabular-nums">{fmt(totals.total)}</p>
    </div>
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 shadow-sm">
      <p className="text-xs text-blue-700">ซื้อสินค้า</p>
      <p className="mt-0.5 text-xl font-bold text-blue-700 tabular-nums">{fmt(totals.purchase)}</p>
    </div>
    <div className="rounded-lg border border-orange-100 bg-orange-50 p-3 shadow-sm">
      <p className="text-xs text-orange-700">ค่าใช้จ่าย</p>
      <p className="mt-0.5 text-xl font-bold text-orange-700 tabular-nums">{fmt(totals.expense)}</p>
    </div>
    <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 shadow-sm">
      <p className="text-xs text-amber-700">เงินมัดจำซัพพลายเออร์</p>
      <p className="mt-0.5 text-xl font-bold text-amber-700 tabular-nums">{fmt(totals.supplierAdvance)}</p>
    </div>
    <div className="rounded-lg border border-teal-100 bg-teal-50 p-3 shadow-sm">
      <p className="text-xs text-teal-700">จ่ายชำระซัพพลายเออร์</p>
      <p className="mt-0.5 text-xl font-bold text-teal-700 tabular-nums">{fmt(totals.supplierPayment)}</p>
    </div>
    <div className="rounded-lg border border-purple-100 bg-purple-50 p-3 shadow-sm">
      <p className="text-xs text-purple-700">คืนเงินลูกค้า (CN)</p>
      <p className="mt-0.5 text-xl font-bold text-purple-700 tabular-nums">{fmt(totals.cnRefund)}</p>
    </div>
  </div>
);

export default async function PaymentsReportResults({ filters }: { filters: ReportFilters }) {
  const rows = await queryDailyPaymentRows(filters);

  const totals: PaymentSummaryTotals = {
    total: sumActiveByDocType(rows),
    purchase: sumActiveByDocType(rows, "ซื้อสินค้า"),
    expense: sumActiveByDocType(rows, "ค่าใช้จ่าย"),
    supplierAdvance: sumActiveByDocType(rows, "เงินมัดจำซัพพลายเออร์"),
    supplierPayment: sumActiveByDocType(rows, "จ่ายชำระซัพพลายเออร์"),
    cnRefund: sumActiveByDocType(rows, "คืนเงินลูกค้า"),
  };

  return (
    <>
      <PaymentSummaryCards totals={totals} />

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
              <td className="whitespace-nowrap px-3 py-2">{formatDateThai(row.docDate)}</td>
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
                {fmt(rows.reduce((sum, row) => sum + row.amount, 0))}
              </td>
            </tr>
          </tfoot>
        )}
      </ReportTableShell>
    </>
  );
}
