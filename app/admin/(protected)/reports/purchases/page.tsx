export const dynamic = "force-dynamic";

import Link from "next/link";
import { FileSpreadsheet, FileText } from "lucide-react";
import { requirePermission } from "@/lib/require-auth";
import {
  parseReportQueryFilters,
  queryPurchaseRows,
  buildExportQuery,
  statusLabel,
  type PurchaseRow,
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

export default async function PurchasesReportPage({ searchParams }: PageProps) {
  await requirePermission("reports.view");
  const params = await searchParams;
  const filters = parseReportQueryFilters(params);
  const rows = await queryPurchaseRows(filters);

  const totalSubtotal = rows.reduce((s, r) => s + r.subtotalAmount, 0);
  const totalVat = rows.reduce((s, r) => s + r.vatAmount, 0);
  const totalAmount = rows.reduce((s, r) => s + r.totalAmount, 0);
  const exportQuery = buildExportQuery(filters);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <form method="GET" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          ตั้งแต่วันที่
          <input type="date" name="from" defaultValue={filters.fromStr}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          ถึงวันที่
          <input type="date" name="to" defaultValue={filters.toStr}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600 self-end mb-1">
          <input type="checkbox" name="showCancelled" value="1"
            defaultChecked={filters.showCancelled}
            className="h-4 w-4 rounded border-gray-300" />
          รวมที่ยกเลิก
        </label>
        <button type="submit"
          className="h-9 self-end rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055]">
          แสดงรายงาน
        </button>
        <Link href="/admin/reports/purchases"
          className="h-9 self-end inline-flex items-center rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200">
          ล้าง
        </Link>
        <div className="flex gap-2 ml-auto self-end">
          <Link href={`/admin/reports/export?type=purchases&${exportQuery}`}
            className="h-9 inline-flex items-center gap-2 rounded-md bg-gray-600 px-3 text-sm font-medium text-white hover:bg-gray-700">
            <FileText size={14} />
            CSV
          </Link>
          <Link href={`/admin/reports/export-excel?type=purchases&${exportQuery}`}
            className="h-9 inline-flex items-center gap-2 rounded-md bg-green-600 px-3 text-sm font-medium text-white hover:bg-green-700">
            <FileSpreadsheet size={14} />
            Excel
          </Link>
        </div>
      </form>

      <p className="text-sm text-gray-500">
        แสดง <span className="font-semibold text-gray-900">{rows.length}</span> รายการ
        {rows.length >= 2000 && " (จำกัด 2,000 รายการ)"}
      </p>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-[#1e3a5f] text-white">
            <tr>
              <th className="px-3 py-2.5 text-center font-medium w-10">#</th>
              <th className="px-3 py-2.5 text-left font-medium">เลขที่เอกสาร</th>
              <th className="px-3 py-2.5 text-left font-medium">วันที่</th>
              <th className="px-3 py-2.5 text-left font-medium">รหัสซัพพลายเออร์</th>
              <th className="px-3 py-2.5 text-left font-medium">ชื่อซัพพลายเออร์</th>
              <th className="px-3 py-2.5 text-left font-medium">เลขอ้างอิง</th>
              <th className="px-3 py-2.5 text-center font-medium">สถานะ</th>
              <th className="px-3 py-2.5 text-left font-medium">รหัสสินค้า</th>
              <th className="px-3 py-2.5 text-left font-medium">ชื่อสินค้า</th>
              <th className="px-3 py-2.5 text-right font-medium">จำนวน</th>
              <th className="px-3 py-2.5 text-left font-medium">หน่วย</th>
              <th className="px-3 py-2.5 text-right font-medium">ราคา/หน่วย</th>
              <th className="px-3 py-2.5 text-right font-medium">ก่อน VAT</th>
              <th className="px-3 py-2.5 text-left font-medium">VAT Type</th>
              <th className="px-3 py-2.5 text-right font-medium">VAT</th>
              <th className="px-3 py-2.5 text-right font-medium">รวม</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={16} className="px-4 py-10 text-center text-gray-400">
                  ไม่พบข้อมูลในช่วงวันที่ที่เลือก
                </td>
              </tr>
            )}
            {rows.map((row: PurchaseRow) => (
              <tr
                key={`${row.docNo}-${row.rowNo}`}
                className={`hover:bg-gray-50 transition-colors ${row.status === "CANCELLED" ? "opacity-50 line-through" : ""}`}
              >
                <td className="px-3 py-2 text-center text-gray-400 tabular-nums">{row.rowNo}</td>
                <td className="px-3 py-2 font-mono text-xs font-medium text-[#1e3a5f]">{row.docNo}</td>
                <td className="px-3 py-2 whitespace-nowrap">{fmtDate(row.docDate)}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.supplierCode}</td>
                <td className="px-3 py-2">{row.supplierName}</td>
                <td className="px-3 py-2 text-gray-500 font-mono text-xs">{row.referenceNo}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                    row.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                  }`}>
                    {statusLabel(row.status)}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{row.productCode}</td>
                <td className="px-3 py-2">{row.productName}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.qty.toLocaleString("th-TH")}</td>
                <td className="px-3 py-2 text-gray-500">{row.unitName}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(row.unitPrice)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(row.subtotalAmount)}</td>
                <td className="px-3 py-2 text-gray-500 text-xs">{row.vatType}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(row.vatAmount)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt(row.totalAmount)}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-gray-50 border-t-2 border-gray-200">
              <tr>
                <td colSpan={12} className="px-3 py-2.5 text-right text-sm font-semibold text-gray-700">รวมทั้งสิ้น</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmt(totalSubtotal)}</td>
                <td />
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmt(totalVat)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-bold text-[#1e3a5f]">{fmt(totalAmount)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
