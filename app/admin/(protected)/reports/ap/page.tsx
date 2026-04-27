export const dynamic = "force-dynamic";

import Link from "next/link";
import { FileSpreadsheet, FileText } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import {
  parseARAPStockFilters,
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

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

function formatDate(value: Date): string {
  return formatDateThai(value);
}

function formatCurrency(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildQuery(
  filters: ARAPStockFilters,
  supplierId: string | undefined,
  view: "outstanding" | "register",
): string {
  const params = new URLSearchParams();
  params.set("from", filters.fromStr);
  params.set("to", filters.toStr);
  if (supplierId) params.set("supplierId", supplierId);
  if (view === "register") params.set("view", "register");
  return params.toString();
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

export default async function APReportPage({ searchParams }: PageProps) {
  await requirePermission("reports.view");
  const params = await searchParams;
  const filters = parseARAPStockFilters(params);
  const view: "outstanding" | "register" = params.view === "register" ? "register" : "outstanding";

  const [suppliers, apData, registerRows] = await Promise.all([
    db.supplier.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 500,
    }),
    filters.hasFilter && view === "outstanding"
      ? queryAPData(filters)
      : Promise.resolve({ purchases: [], advances: [], cnCredits: [] }),
    filters.hasFilter && view === "register" ? queryAPRegisterRows(filters) : Promise.resolve([] as APRegisterRow[]),
  ]);

  const totalPayable = apData.purchases.reduce((sum, r) => sum + r.amountRemain, 0);
  const totalAdvance = apData.advances.reduce((sum, r) => sum + r.amountRemain, 0);
  const totalCN = apData.cnCredits.reduce((sum, r) => sum + r.amountRemain, 0);
  const netPayable = totalPayable - totalAdvance - totalCN;
  const registerSummary = summarizeAPRegister(registerRows);
  const exportQuery = buildQuery(filters, params.supplierId, view);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-kanit text-2xl font-bold text-gray-900">เจ้าหนี้คงค้าง (AP)</h1>
        <p className="text-sm text-gray-500">
          ยอดค้างจ่ายซัพพลายเออร์ เงินมัดจำคงเหลือ และเครดิต CN คืนสินค้า
        </p>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          วันที่เอกสาร (ตั้งแต่)
          <input
            type="date"
            name="from"
            defaultValue={filters.fromStr}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          วันที่เอกสาร (ถึง)
          <input
            type="date"
            name="to"
            defaultValue={filters.toStr}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          มุมมอง
          <select
            name="view"
            defaultValue={view}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="outstanding">รายงานเดิม (คงค้าง)</option>
            <option value="register">Register (ทะเบียนเอกสาร)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          ซัพพลายเออร์
          <select
            name="supplierId"
            defaultValue={params.supplierId ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">ทั้งหมด</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="h-9 rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055]"
        >
          แสดงรายการ
        </button>
        <Link
          href="/admin/reports/ap"
          className="inline-flex h-9 items-center rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200"
        >
          ล้าง
        </Link>
        <div className="ml-auto flex gap-2">
          <Link
            href={`/admin/reports/export?type=ap&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-gray-600 px-3 text-sm font-medium text-white hover:bg-gray-700"
          >
            <FileText size={14} />
            CSV
          </Link>
          <Link
            href={`/admin/reports/export-excel?type=ap&${exportQuery}`}
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
      ) : view === "register" ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-5">
            <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">จำนวนเอกสาร</p>
              <p className="font-kanit text-2xl font-bold text-gray-900">{registerSummary.count}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">ยอดซื้อรวม</p>
              <p className="font-kanit text-2xl font-bold text-gray-900">฿{formatCurrency(registerSummary.totalNet)}</p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm">
              <p className="text-xs text-emerald-700">จ่ายแล้ว</p>
              <p className="font-kanit text-2xl font-bold text-emerald-700">฿{formatCurrency(registerSummary.totalPaid)}</p>
            </div>
            <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 shadow-sm">
              <p className="text-xs text-rose-600">คงค้าง</p>
              <p className="font-kanit text-2xl font-bold text-rose-700">฿{formatCurrency(registerSummary.totalRemain)}</p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 shadow-sm">
              <p className="text-xs text-amber-700">เกินกำหนด</p>
              <p className="font-kanit text-2xl font-bold text-amber-700">฿{formatCurrency(registerSummary.totalOverdue)}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#1e3a5f] text-white">
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
                      <td colSpan={11} className="px-4 py-10 text-center text-gray-400">
                        ไม่พบเอกสารในช่วงวันที่ที่เลือก
                      </td>
                    </tr>
                  ) : (
                    registerRows.map((row) => (
                      <tr
                        key={`${row.kind}:${row.id}`}
                        className={`hover:bg-gray-50 ${row.status === "CANCELLED" ? "italic text-gray-400" : ""}`}
                      >
                        <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f]">{row.docNo}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-600">{formatDate(row.docDate)}</td>
                        <td className="px-3 py-2 text-gray-800">{row.supplierName}</td>
                        <td className="px-3 py-2 text-gray-600">{AP_TYPE_LABELS[row.rowType]}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.netAmount)}</td>
                        <td className="px-3 py-2 text-right text-emerald-700">{formatCurrency(row.paidAmount)}</td>
                        <td className="px-3 py-2 text-right font-medium text-rose-700">{formatCurrency(row.amountRemain)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-600">{row.dueDate ? formatDate(row.dueDate) : "-"}</td>
                        <td className="px-3 py-2 text-right text-amber-700">
                          {row.daysOverdue != null && row.daysOverdue > 0 ? row.daysOverdue : "-"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[row.status] ?? ""}`}>
                            {STATUS_LABELS[row.status]}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Link href={apDocLink(row)} className="text-xs font-medium text-[#1e3a5f] hover:underline">
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
      ) : (
        <div className="space-y-6">
          {/* Net Position Summary */}
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 shadow-sm">
              <p className="text-xs text-rose-600">ค้างจ่ายซัพพลายเออร์</p>
              <p className="font-kanit text-xl font-bold text-rose-700">฿{formatCurrency(totalPayable)}</p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm">
              <p className="text-xs text-emerald-600">เงินมัดจำคงเหลือ (ลบ)</p>
              <p className="font-kanit text-xl font-bold text-emerald-700">฿{formatCurrency(totalAdvance)}</p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 shadow-sm">
              <p className="text-xs text-amber-700">เครดิต CN คืนสินค้า (ลบ)</p>
              <p className="font-kanit text-xl font-bold text-amber-700">฿{formatCurrency(totalCN)}</p>
            </div>
            <div className={`rounded-xl border p-4 shadow-sm ${netPayable >= 0 ? "border-gray-100 bg-[#1e3a5f]/5" : "border-emerald-100 bg-emerald-50"}`}>
              <p className="text-xs text-gray-600">ยอดสุทธิคงค้าง</p>
              <p className={`font-kanit text-xl font-bold ${netPayable >= 0 ? "text-[#1e3a5f]" : "text-emerald-700"}`}>
                ฿{formatCurrency(Math.abs(netPayable))} {netPayable < 0 ? "(เกินจ่าย)" : ""}
              </p>
            </div>
          </div>

          {/* AP Outstanding - Purchases */}
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="font-kanit text-base font-semibold text-gray-900">ค้างจ่ายซัพพลายเออร์ (ซื้อเชื่อ)</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#1e3a5f] text-white">
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
                      <td colSpan={6} className="px-4 py-6 text-center text-gray-400">ไม่พบรายการ</td>
                    </tr>
                  ) : (
                    apData.purchases.map((row) => (
                      <tr key={row.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f]">{row.purchaseNo}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-600">{formatDate(row.purchaseDate)}</td>
                        <td className="px-3 py-2 text-gray-800">{row.supplierName || "-"}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.totalAmount)}</td>
                        <td className="px-3 py-2 text-right font-medium text-rose-700">{formatCurrency(row.amountRemain)}</td>
                        <td className="px-3 py-2 text-center">
                          <Link href={`/admin/purchases/${row.id}`} className="text-xs font-medium text-[#1e3a5f] hover:underline">เปิด</Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Supplier Advances */}
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="font-kanit text-base font-semibold text-gray-900">เงินมัดจำซัพพลายเออร์คงเหลือ</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#1e3a5f] text-white">
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
                      <td colSpan={6} className="px-4 py-6 text-center text-gray-400">ไม่พบรายการ</td>
                    </tr>
                  ) : (
                    apData.advances.map((row) => (
                      <tr key={row.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f]">{row.advanceNo}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-600">{formatDate(row.advanceDate)}</td>
                        <td className="px-3 py-2 text-gray-800">{row.supplierName || "-"}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.totalAmount)}</td>
                        <td className="px-3 py-2 text-right font-medium text-emerald-700">{formatCurrency(row.amountRemain)}</td>
                        <td className="px-3 py-2 text-center">
                          <Link href={`/admin/supplier-advances/${row.id}`} className="text-xs font-medium text-[#1e3a5f] hover:underline">เปิด</Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* CN Purchase Credit */}
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="font-kanit text-base font-semibold text-gray-900">เครดิตคืนสินค้า (CN Purchase) คงเหลือ</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#1e3a5f] text-white">
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
                      <td colSpan={6} className="px-4 py-6 text-center text-gray-400">ไม่พบรายการ</td>
                    </tr>
                  ) : (
                    apData.cnCredits.map((row) => (
                      <tr key={row.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f]">{row.returnNo}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-600">{formatDate(row.returnDate)}</td>
                        <td className="px-3 py-2 text-gray-800">{row.supplierName || "-"}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.totalAmount)}</td>
                        <td className="px-3 py-2 text-right font-medium text-amber-700">{formatCurrency(row.amountRemain)}</td>
                        <td className="px-3 py-2 text-center">
                          <Link href={`/admin/purchase-returns/${row.id}`} className="text-xs font-medium text-[#1e3a5f] hover:underline">เปิด</Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
