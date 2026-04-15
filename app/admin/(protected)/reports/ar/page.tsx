export const dynamic = "force-dynamic";

import Link from "next/link";
import { FileSpreadsheet, FileText } from "lucide-react";
import { requirePermission } from "@/lib/require-auth";
import { db } from "@/lib/db";
import {
  parseARAPStockFilters,
  queryARRows,
  type ARAPStockFilters,
} from "@/lib/ar-ap-stock-report-queries";

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

function buildQuery(filters: ARAPStockFilters, customerId: string | undefined): string {
  const params = new URLSearchParams();
  params.set("from", filters.fromStr);
  params.set("to", filters.toStr);
  if (customerId) params.set("customerId", customerId);
  if (filters.arMode && filters.arMode !== "ALL") params.set("arMode", filters.arMode);
  return params.toString();
}

export default async function ARReportPage({ searchParams }: PageProps) {
  await requirePermission("reports.view");
  const params = await searchParams;
  const filters = parseARAPStockFilters(params);

  const [customers, rows] = await Promise.all([
    db.customer.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 500,
    }),
    filters.hasFilter ? queryARRows(filters) : Promise.resolve([]),
  ]);

  const totalRemain = rows.reduce((sum, row) => sum + row.amountRemain, 0);
  const totalAmount = rows.reduce((sum, row) => sum + row.totalAmount, 0);
  const exportQuery = buildQuery(filters, params.customerId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-kanit text-2xl font-bold text-gray-900">ลูกหนี้ค้างชำระ (AR)</h1>
        <p className="text-sm text-gray-500">
          รายการขายเชื่อที่ยังค้างชำระ สามารถกรองเฉพาะลูกหนี้ COD ได้
        </p>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          วันที่ขาย (ตั้งแต่)
          <input
            type="date"
            name="from"
            defaultValue={filters.fromStr}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          วันที่ขาย (ถึง)
          <input
            type="date"
            name="to"
            defaultValue={filters.toStr}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          ลูกค้า
          <select
            name="customerId"
            defaultValue={params.customerId ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">ทุกลูกค้า</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          ประเภทลูกหนี้
          <select
            name="arMode"
            defaultValue={filters.arMode ?? "ALL"}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="ALL">ทั้งหมด</option>
            <option value="NORMAL">ลูกหนี้ทั่วไป</option>
            <option value="COD">ลูกหนี้ COD</option>
          </select>
        </label>
        <button
          type="submit"
          className="h-9 rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055]"
        >
          แสดงรายการ
        </button>
        <Link
          href="/admin/reports/ar"
          className="inline-flex h-9 items-center rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200"
        >
          ล้าง
        </Link>
        <div className="ml-auto flex gap-2">
          <Link
            href={`/admin/reports/export?type=ar&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-gray-600 px-3 text-sm font-medium text-white hover:bg-gray-700"
          >
            <FileText size={14} />
            CSV
          </Link>
          <Link
            href={`/admin/reports/export-excel?type=ar&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-3 text-sm font-medium text-white hover:bg-green-700"
          >
            <FileSpreadsheet size={14} />
            Excel
          </Link>
        </div>
      </form>

      {!filters.hasFilter ? (
        <div className="rounded-xl border border-gray-100 bg-white p-12 text-center shadow-sm">
          <p className="text-gray-400">เลือกช่วงวันที่แล้วกด “แสดงรายการ” เพื่อดูข้อมูล</p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">จำนวนเอกสาร</p>
              <p className="font-kanit text-2xl font-bold text-gray-900">{rows.length}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">ยอดขายรวม</p>
              <p className="font-kanit text-2xl font-bold text-gray-900">฿{formatCurrency(totalAmount)}</p>
            </div>
            <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 shadow-sm">
              <p className="text-xs text-rose-600">ยอดค้างชำระรวม</p>
              <p className="font-kanit text-2xl font-bold text-rose-700">฿{formatCurrency(totalRemain)}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#1e3a5f] text-white">
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
                      <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                        ไม่พบลูกหนี้ค้างชำระตามเงื่อนไขที่เลือก
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr key={row.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f]">{row.saleNo}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-600">{formatDate(row.saleDate)}</td>
                        <td className="px-3 py-2 text-gray-800">{row.customer?.name ?? row.customerName ?? "-"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                          {row.customer?.phone ?? row.customerPhone ?? "-"}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.totalAmount)}</td>
                        <td className="px-3 py-2 text-right font-medium text-rose-700">{formatCurrency(row.amountRemain)}</td>
                        <td className="px-3 py-2 text-right text-gray-500">
                          {row.creditTerm != null ? `${row.creditTerm} วัน` : "-"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Link
                            href={`/admin/sales/${row.id}`}
                            className="text-xs font-medium text-[#1e3a5f] hover:underline"
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
      )}
    </div>
  );
}
