import Link from "next/link";

import {
  queryAPData,
  type ARAPStockFilters,
} from "@/lib/ar-ap-stock-report-queries";
import {
  queryAPRegisterRows,
  summarizeAPRegister,
  STATUS_LABELS,
  AP_TYPE_LABELS,
  type APRegisterRow,
} from "@/lib/ar-ap-register-queries";
import { formatDateThai } from "@/lib/th-date";

/**
 * The awaited half of the AP report. Only the query for the active view runs,
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

function apDocLink(row: APRegisterRow): string {
  if (row.kind === "PURCHASE") return `/admin/purchases/${row.id}`;
  if (row.kind === "ADVANCE") return `/admin/supplier-advances/${row.id}`;
  return `/admin/purchase-returns/${row.id}`;
}

async function APRegisterView({ filters }: { filters: ARAPStockFilters }) {
  const registerRows = await queryAPRegisterRows(filters);
  const registerSummary = summarizeAPRegister(registerRows);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-5">
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
          <p className="text-xs text-gray-500 dark:text-slate-400">จำนวนเอกสาร</p>
          <p className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">{registerSummary.count}</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
          <p className="text-xs text-gray-500 dark:text-slate-400">ยอดซื้อรวม</p>
          <p className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">฿{formatCurrency(registerSummary.totalNet)}</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm dark:border-emerald-400/20 dark:bg-emerald-500/10">
          <p className="text-xs text-emerald-700 dark:text-emerald-200">จ่ายแล้ว</p>
          <p className="font-kanit text-2xl font-bold text-emerald-700 dark:text-emerald-100">฿{formatCurrency(registerSummary.totalPaid)}</p>
        </div>
        <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 shadow-sm dark:border-rose-400/20 dark:bg-rose-500/10">
          <p className="text-xs text-rose-600 dark:text-rose-200">คงค้าง</p>
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
                <th className="px-3 py-2.5 text-left font-medium">ผู้จำหน่าย</th>
                <th className="px-3 py-2.5 text-left font-medium">ประเภท</th>
                <th className="px-3 py-2.5 text-right font-medium">ยอด</th>
                <th className="px-3 py-2.5 text-right font-medium">จ่ายแล้ว</th>
                <th className="px-3 py-2.5 text-right font-medium">คงเหลือ</th>
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
                    <td className="px-3 py-2 text-gray-800 dark:text-slate-100">{row.supplierName}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-300">{AP_TYPE_LABELS[row.rowType]}</td>
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
                      <Link href={apDocLink(row)} className="text-xs font-medium text-[#1e3a5f] hover:underline dark:text-sky-200">
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
    </div>
  );
}

async function APOutstandingView({ filters }: { filters: ARAPStockFilters }) {
  const apData = await queryAPData(filters);

  const totalPayable = apData.purchases.reduce((sum, r) => sum + r.amountRemain, 0);
  const totalAdvance = apData.advances.reduce((sum, r) => sum + r.amountRemain, 0);
  const totalCN = apData.cnCredits.reduce((sum, r) => sum + r.amountRemain, 0);
  const netPayable = totalPayable - totalAdvance - totalCN;

  return (
      <div className="space-y-6">
      {/* Net Position Summary */}
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 shadow-sm dark:border-rose-400/20 dark:bg-rose-500/10">
          <p className="text-xs text-rose-600 dark:text-rose-200">ค้างจ่ายซัพพลายเออร์</p>
          <p className="font-kanit text-xl font-bold text-rose-700 dark:text-rose-100">฿{formatCurrency(totalPayable)}</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm dark:border-emerald-400/20 dark:bg-emerald-500/10">
          <p className="text-xs text-emerald-600 dark:text-emerald-200">เงินมัดจำคงเหลือ (ลบ)</p>
          <p className="font-kanit text-xl font-bold text-emerald-700 dark:text-emerald-100">฿{formatCurrency(totalAdvance)}</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 shadow-sm dark:border-amber-400/20 dark:bg-amber-500/10">
          <p className="text-xs text-amber-700 dark:text-amber-200">เครดิต CN คืนสินค้า (ลบ)</p>
          <p className="font-kanit text-xl font-bold text-amber-700 dark:text-amber-100">฿{formatCurrency(totalCN)}</p>
        </div>
        <div className={`rounded-xl border p-4 shadow-sm ${netPayable >= 0 ? "border-gray-100 bg-[#1e3a5f]/5 dark:border-white/10 dark:bg-sky-500/10" : "border-emerald-100 bg-emerald-50 dark:border-emerald-400/20 dark:bg-emerald-500/10"}`}>
          <p className="text-xs text-gray-600 dark:text-slate-300">ยอดสุทธิคงค้าง</p>
          <p className={`font-kanit text-xl font-bold ${netPayable >= 0 ? "text-[#1e3a5f] dark:text-sky-200" : "text-emerald-700 dark:text-emerald-100"}`}>
            ฿{formatCurrency(Math.abs(netPayable))} {netPayable < 0 ? "(เกินจ่าย)" : ""}
          </p>
        </div>
      </div>

      {/* AP Outstanding - Purchases */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/40">
        <div className="border-b border-gray-100 px-4 py-3 dark:border-white/10">
          <h2 className="font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">ค้างจ่ายซัพพลายเออร์ (ซื้อเชื่อ)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#1e3a5f] text-white dark:bg-slate-900">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">เลขที่</th>
                <th className="px-3 py-2.5 text-left font-medium">วันที่ซื้อ</th>
                <th className="px-3 py-2.5 text-left font-medium">ซัพพลายเออร์</th>
                <th className="px-3 py-2.5 text-right font-medium">ยอดซื้อ</th>
                <th className="px-3 py-2.5 text-right font-medium">ค้างจ่าย</th>
                <th className="px-3 py-2.5 text-center font-medium">เอกสาร</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {apData.purchases.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-400 dark:text-slate-500">ไม่พบรายการ</td>
                </tr>
              ) : (
                apData.purchases.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-white/5">
                    <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f] dark:text-sky-200">{row.purchaseNo}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-slate-300">{formatDate(row.purchaseDate)}</td>
                    <td className="px-3 py-2 text-gray-800 dark:text-slate-100">{row.supplierName || "-"}</td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-slate-200">{formatCurrency(row.totalAmount)}</td>
                    <td className="px-3 py-2 text-right font-medium text-rose-700 dark:text-rose-200">{formatCurrency(row.amountRemain)}</td>
                    <td className="px-3 py-2 text-center">
                      <Link href={`/admin/purchases/${row.id}`} className="text-xs font-medium text-[#1e3a5f] hover:underline dark:text-sky-200">เปิด</Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Supplier Advances */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/40">
        <div className="border-b border-gray-100 px-4 py-3 dark:border-white/10">
          <h2 className="font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">เงินมัดจำซัพพลายเออร์คงเหลือ</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#1e3a5f] text-white dark:bg-slate-900">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">เลขที่</th>
                <th className="px-3 py-2.5 text-left font-medium">วันที่</th>
                <th className="px-3 py-2.5 text-left font-medium">ซัพพลายเออร์</th>
                <th className="px-3 py-2.5 text-right font-medium">ยอดมัดจำ</th>
                <th className="px-3 py-2.5 text-right font-medium">คงเหลือ</th>
                <th className="px-3 py-2.5 text-center font-medium">เอกสาร</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {apData.advances.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-400 dark:text-slate-500">ไม่พบรายการ</td>
                </tr>
              ) : (
                apData.advances.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-white/5">
                    <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f] dark:text-sky-200">{row.advanceNo}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-slate-300">{formatDate(row.advanceDate)}</td>
                    <td className="px-3 py-2 text-gray-800 dark:text-slate-100">{row.supplierName || "-"}</td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-slate-200">{formatCurrency(row.totalAmount)}</td>
                    <td className="px-3 py-2 text-right font-medium text-emerald-700 dark:text-emerald-200">{formatCurrency(row.amountRemain)}</td>
                    <td className="px-3 py-2 text-center">
                      <Link href={`/admin/supplier-advances/${row.id}`} className="text-xs font-medium text-[#1e3a5f] hover:underline dark:text-sky-200">เปิด</Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CN Purchase Credit */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/40">
        <div className="border-b border-gray-100 px-4 py-3 dark:border-white/10">
          <h2 className="font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">เครดิตคืนสินค้า (CN Purchase) คงเหลือ</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#1e3a5f] text-white dark:bg-slate-900">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">เลขที่</th>
                <th className="px-3 py-2.5 text-left font-medium">วันที่คืน</th>
                <th className="px-3 py-2.5 text-left font-medium">ซัพพลายเออร์</th>
                <th className="px-3 py-2.5 text-right font-medium">ยอดคืน</th>
                <th className="px-3 py-2.5 text-right font-medium">คงเหลือ</th>
                <th className="px-3 py-2.5 text-center font-medium">เอกสาร</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {apData.cnCredits.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-400 dark:text-slate-500">ไม่พบรายการ</td>
                </tr>
              ) : (
                apData.cnCredits.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-white/5">
                    <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f] dark:text-sky-200">{row.returnNo}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-slate-300">{formatDate(row.returnDate)}</td>
                    <td className="px-3 py-2 text-gray-800 dark:text-slate-100">{row.supplierName || "-"}</td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-slate-200">{formatCurrency(row.totalAmount)}</td>
                    <td className="px-3 py-2 text-right font-medium text-amber-700 dark:text-amber-200">{formatCurrency(row.amountRemain)}</td>
                    <td className="px-3 py-2 text-center">
                      <Link href={`/admin/purchase-returns/${row.id}`} className="text-xs font-medium text-[#1e3a5f] hover:underline dark:text-sky-200">เปิด</Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default async function APReportResults({
  filters,
  view,
}: {
  filters: ARAPStockFilters;
  view: "outstanding" | "register";
}) {
  return view === "register" ? (
    <APRegisterView filters={filters} />
  ) : (
    <APOutstandingView filters={filters} />
  );
}
