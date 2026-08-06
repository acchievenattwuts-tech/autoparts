import Link from "next/link";

import {
  queryARRows,
  type ARAPStockFilters,
} from "@/lib/ar-ap-stock-report-queries";
import {
  queryARRegisterRows,
  summarizeARRegister,
  STATUS_LABELS,
  AR_TYPE_LABELS,
} from "@/lib/ar-ap-register-queries";
import { formatDateThai } from "@/lib/th-date";

/**
 * The awaited half of the AR report. Only the query for the active view runs,
 * matching the previous conditional Promise.all in page.tsx.
 */

function formatDate(value: Date): string {
  return formatDateThai(value);
}

function formatCurrency(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const STATUS_BADGE: Record<string, string> = {
  PAID: "bg-emerald-100 text-emerald-700",
  PARTIAL: "bg-amber-100 text-amber-700",
  UNPAID: "bg-blue-100 text-blue-700",
  OVERDUE: "bg-rose-100 text-rose-700",
  CANCELLED: "bg-gray-200 text-gray-500",
};

async function ARRegisterView({ filters }: { filters: ARAPStockFilters }) {
  const registerRows = await queryARRegisterRows(filters);
  const registerSummary = summarizeARRegister(registerRows);

  return (
    <>
          <div className="grid gap-3 md:grid-cols-5">
            <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
              <p className="text-xs text-gray-500 dark:text-slate-400">จำนวนเอกสาร</p>
              <p className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">{registerSummary.count}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
              <p className="text-xs text-gray-500 dark:text-slate-400">ยอดขายรวม</p>
              <p className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">฿{formatCurrency(registerSummary.totalNet)}</p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm dark:border-emerald-400/20 dark:bg-emerald-500/10">
              <p className="text-xs text-emerald-700 dark:text-emerald-200">รับชำระแล้ว</p>
              <p className="font-kanit text-2xl font-bold text-emerald-700 dark:text-emerald-100">฿{formatCurrency(registerSummary.totalPaid)}</p>
            </div>
            <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 shadow-sm dark:border-rose-400/20 dark:bg-rose-500/10">
              <p className="text-xs text-rose-600 dark:text-rose-200">ค้างชำระ</p>
              <p className="font-kanit text-2xl font-bold text-rose-700 dark:text-rose-100">฿{formatCurrency(registerSummary.totalRemain)}</p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 shadow-sm dark:border-amber-400/20 dark:bg-amber-500/10">
              <p className="text-xs text-amber-700 dark:text-amber-200">เกินกำหนด</p>
              <p className="font-kanit text-2xl font-bold text-amber-700 dark:text-amber-100">฿{formatCurrency(registerSummary.totalOverdue)}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/40">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#1e3a5f] text-white dark:bg-slate-900">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-medium">เลขที่</th>
                    <th className="px-3 py-2.5 text-left font-medium">วันที่</th>
                    <th className="px-3 py-2.5 text-left font-medium">ลูกค้า</th>
                    <th className="px-3 py-2.5 text-left font-medium">ประเภท</th>
                    <th className="px-3 py-2.5 text-right font-medium">ยอด</th>
                    <th className="px-3 py-2.5 text-right font-medium">รับแล้ว</th>
                    <th className="px-3 py-2.5 text-right font-medium">ค้าง</th>
                    <th className="px-3 py-2.5 text-left font-medium">ครบกำหนด</th>
                    <th className="px-3 py-2.5 text-right font-medium">เกิน (วัน)</th>
                    <th className="px-3 py-2.5 text-center font-medium">สถานะ</th>
                    <th className="px-3 py-2.5 text-center font-medium">เอกสาร</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {registerRows.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">
                        ไม่พบเอกสารในช่วงวันที่ที่เลือก
                      </td>
                    </tr>
                  ) : (
                    registerRows.map((row) => (
                      <tr
                        key={`${row.kind}:${row.id}`}
                        className={`hover:bg-gray-50 dark:hover:bg-white/5 ${row.status === "CANCELLED" ? "italic text-gray-400 dark:text-slate-500" : ""}`}
                      >
                        <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f] dark:text-sky-200">{row.docNo}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-slate-300">{formatDate(row.docDate)}</td>
                        <td className="px-3 py-2 text-gray-800 dark:text-slate-100">{row.customerName}</td>
                        <td className="px-3 py-2 text-gray-600 dark:text-slate-300">{AR_TYPE_LABELS[row.paymentType]}</td>
                        <td className="px-3 py-2 text-right text-gray-700 dark:text-slate-200">{formatCurrency(row.netAmount)}</td>
                        <td className="px-3 py-2 text-right text-emerald-700 dark:text-emerald-200">{formatCurrency(row.paidAmount)}</td>
                        <td className="px-3 py-2 text-right font-medium text-rose-700 dark:text-rose-200">{formatCurrency(row.amountRemain)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-slate-300">{row.dueDate ? formatDate(row.dueDate) : "-"}</td>
                        <td className="px-3 py-2 text-right text-amber-700 dark:text-amber-200">
                          {row.daysOverdue != null && row.daysOverdue > 0 ? row.daysOverdue : "-"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[row.status] ?? ""}`}>
                            {STATUS_LABELS[row.status]}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Link
                            href={row.kind === "SALE" ? `/admin/sales/${row.id}` : `/admin/credit-notes/${row.id}`}
                            className="text-xs font-medium text-[#1e3a5f] hover:underline dark:text-sky-200"
                          >
                            เปิด
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
    </>
  );
}

async function AROutstandingView({ filters }: { filters: ARAPStockFilters }) {
  const rows = await queryARRows(filters);
  const totalRemain = rows.reduce((sum, row) => sum + row.amountRemain, 0);
  const totalAmount = rows.reduce((sum, row) => sum + row.totalAmount, 0);

  return (
    <>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
              <p className="text-xs text-gray-500 dark:text-slate-400">จำนวนเอกสาร</p>
              <p className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">{rows.length}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
              <p className="text-xs text-gray-500 dark:text-slate-400">ยอดขายรวม</p>
              <p className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">฿{formatCurrency(totalAmount)}</p>
            </div>
            <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 shadow-sm dark:border-rose-400/20 dark:bg-rose-500/10">
              <p className="text-xs text-rose-600 dark:text-rose-200">ยอดค้างชำระรวม</p>
              <p className="font-kanit text-2xl font-bold text-rose-700 dark:text-rose-100">฿{formatCurrency(totalRemain)}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/40">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#1e3a5f] text-white dark:bg-slate-900">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-medium">เลขที่</th>
                    <th className="px-3 py-2.5 text-left font-medium">วันที่ขาย</th>
                    <th className="px-3 py-2.5 text-left font-medium">ลูกค้า</th>
                    <th className="px-3 py-2.5 text-left font-medium">เบอร์โทร</th>
                    <th className="px-3 py-2.5 text-right font-medium">ยอดขาย</th>
                    <th className="px-3 py-2.5 text-right font-medium">ค้างชำระ</th>
                    <th className="px-3 py-2.5 text-right font-medium">เครดิต (วัน)</th>
                    <th className="px-3 py-2.5 text-center font-medium">เอกสาร</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">
                        ไม่พบลูกหนี้ค้างชำระตามเงื่อนไขที่เลือก
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-white/5">
                        <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f] dark:text-sky-200">{row.saleNo}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-slate-300">{formatDate(row.saleDate)}</td>
                        <td className="px-3 py-2 text-gray-800 dark:text-slate-100">{row.customer?.name ?? row.customerName ?? "-"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-slate-300">
                          {row.customer?.phone ?? row.customerPhone ?? "-"}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-700 dark:text-slate-200">{formatCurrency(row.totalAmount)}</td>
                        <td className="px-3 py-2 text-right font-medium text-rose-700 dark:text-rose-200">{formatCurrency(row.amountRemain)}</td>
                        <td className="px-3 py-2 text-right text-gray-500 dark:text-slate-400">
                          {row.creditTerm != null ? `${row.creditTerm} วัน` : "-"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Link
                            href={`/admin/sales/${row.id}`}
                            className="text-xs font-medium text-[#1e3a5f] hover:underline dark:text-sky-200"
                          >
                            เปิด
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
    </>
  );
}

export default async function ARReportResults({
  filters,
  view,
}: {
  filters: ARAPStockFilters;
  view: "outstanding" | "register";
}) {
  return view === "register" ? (
    <ARRegisterView filters={filters} />
  ) : (
    <AROutstandingView filters={filters} />
  );
}
