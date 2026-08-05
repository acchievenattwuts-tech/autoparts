import Link from "next/link";

import ReportTableShell from "@/components/shared/ReportTableShell";
import { getAdminReportRowClass } from "@/lib/admin-status-presentation";
import { db } from "@/lib/db";
import { DocStatus } from "@/lib/generated/prisma";
import {
  queryPurchaseRows,
  queryPurchaseRowsTotals,
  statusLabel,
  type PurchaseRow,
  type ReportFilters,
} from "@/lib/report-queries";
import { formatDateThai } from "@/lib/th-date";

/**
 * The awaited half of the purchases report.
 *
 * queryPurchaseRows is the slowest report query in the app (p50 ~350ms over 90
 * days), so it sits behind a Suspense boundary instead of holding back the
 * header and the filter form.
 */

const PAGE_SIZE = 100;

function formatCurrency(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function countPurchaseRows(filters: ReportFilters): Promise<number> {
  const statusFilter: { status?: DocStatus } = filters.showCancelled
    ? {}
    : { status: "ACTIVE" };

  return db.purchase.count({
    where: {
      purchaseDate: { gte: filters.from, lte: filters.to },
      ...statusFilter,
      ...(filters.accountId ? { cashBankAccountId: filters.accountId } : {}),
    },
  });
}

type PurchasesReportResultsProps = {
  filters: ReportFilters;
  pageNo: number;
  params: Record<string, string | undefined>;
};

export default async function PurchasesReportResults({
  filters,
  pageNo,
  params,
}: PurchasesReportResultsProps) {
  const [rows, totals, docCount] = await Promise.all([
    queryPurchaseRows(filters, PAGE_SIZE, pageNo),
    queryPurchaseRowsTotals(filters),
    countPurchaseRows(filters),
  ]);

  const totalPages = Math.ceil(docCount / PAGE_SIZE);

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          แสดง <span className="font-semibold text-gray-900">{rows.length}</span> รายการ
          {docCount > 0 && (
            <span className="ml-2 text-gray-600">
              (หน้า {pageNo + 1} จาก {totalPages})
            </span>
          )}
        </p>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Link
              href={`?${new URLSearchParams({
                ...params,
                page: Math.max(0, pageNo - 1).toString(),
              }).toString()}`}
              className={`inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-colors ${
                pageNo === 0
                  ? "pointer-events-none cursor-not-allowed bg-gray-100 text-gray-400"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
              aria-disabled={pageNo === 0}
            >
              ← ก่อนหน้า
            </Link>
            <span className="px-3 text-sm font-medium text-gray-700">
              {pageNo + 1} / {totalPages}
            </span>
            <Link
              href={`?${new URLSearchParams({
                ...params,
                page: Math.min(totalPages - 1, pageNo + 1).toString(),
              }).toString()}`}
              className={`inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-colors ${
                pageNo >= totalPages - 1
                  ? "pointer-events-none cursor-not-allowed bg-gray-100 text-gray-400"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
              aria-disabled={pageNo >= totalPages - 1}
            >
              ถัดไป →
            </Link>
          </div>
        )}
      </div>

      <ReportTableShell tableClassName="min-w-[1520px]">
        <thead className="bg-[#1e3a5f] text-white">
          <tr>
            <th className="w-10 px-3 py-2.5 text-center font-medium">#</th>
            <th className="px-3 py-2.5 text-left font-medium">เลขที่เอกสาร</th>
            <th className="px-3 py-2.5 text-left font-medium">วันที่</th>
            <th className="px-3 py-2.5 text-left font-medium">ประเภทการซื้อ</th>
            <th className="px-3 py-2.5 text-left font-medium">ช่องทางจ่าย</th>
            <th className="px-3 py-2.5 text-left font-medium">บัญชีจ่ายเงิน</th>
            <th className="px-3 py-2.5 text-left font-medium">รหัสซัพพลายเออร์</th>
            <th className="px-3 py-2.5 text-left font-medium">ชื่อซัพพลายเออร์</th>
            <th className="px-3 py-2.5 text-left font-medium">เลขอ้างอิง</th>
            <th className="px-3 py-2.5 text-center font-medium">สถานะเอกสาร</th>
            <th className="px-3 py-2.5 text-left font-medium">รหัสสินค้า</th>
            <th className="px-3 py-2.5 text-left font-medium">ชื่อสินค้า</th>
            <th className="px-3 py-2.5 text-right font-medium">จำนวน</th>
            <th className="px-3 py-2.5 text-left font-medium">หน่วย</th>
            <th className="px-3 py-2.5 text-right font-medium">ราคา/หน่วย</th>
            <th className="px-3 py-2.5 text-right font-medium">ก่อน VAT</th>
            <th className="px-3 py-2.5 text-left font-medium">VAT</th>
            <th className="px-3 py-2.5 text-right font-medium">ภาษี</th>
            <th className="px-3 py-2.5 text-right font-medium">รวม</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.length === 0 && (
            <tr>
              <td colSpan={19} className="px-4 py-10 text-center text-gray-400">
                ไม่พบข้อมูลในช่วงวันที่ที่เลือก
              </td>
            </tr>
          )}
          {rows.map((row: PurchaseRow) => (
            <tr
              key={`${row.docNo}-${row.rowNo}`}
              className={`transition-colors ${getAdminReportRowClass(row.status === "CANCELLED")}`}
            >
              <td className="px-3 py-2 text-center tabular-nums text-gray-400">{row.rowNo}</td>
              <td className="px-3 py-2 font-mono text-xs font-medium text-[#1e3a5f]">{row.docNo}</td>
              <td className="px-3 py-2 whitespace-nowrap">{formatDateThai(row.docDate)}</td>
              <td className="px-3 py-2">{row.purchaseType}</td>
              <td className="px-3 py-2">{row.paymentMethod}</td>
              <td className="px-3 py-2 text-gray-600">{row.accountName}</td>
              <td className="px-3 py-2 font-mono text-xs">{row.supplierCode}</td>
              <td className="px-3 py-2">{row.supplierName}</td>
              <td className="px-3 py-2 font-mono text-xs text-gray-500">{row.referenceNo || "-"}</td>
              <td className="px-3 py-2 text-center">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                    row.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                  }`}
                >
                  {statusLabel(row.status)}
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-xs">{row.productCode}</td>
              <td className="px-3 py-2">{row.productName}</td>
              <td className="px-3 py-2 text-right tabular-nums">{row.qty.toLocaleString("th-TH")}</td>
              <td className="px-3 py-2 text-gray-500">{row.unitName}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(row.unitPrice)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(row.subtotalAmount)}</td>
              <td className="px-3 py-2 text-gray-500 text-xs">{row.vatType}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(row.vatAmount)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(row.totalAmount)}</td>
            </tr>
          ))}
        </tbody>
        {rows.length > 0 && (
          <tfoot className="border-t-2 border-gray-200 bg-gray-50">
            <tr>
              <td colSpan={15} className="px-3 py-2.5 text-right text-sm font-semibold text-gray-700">
                รวมทั้งสิ้น
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                {formatCurrency(totals.subtotal)}
              </td>
              <td />
              <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                {formatCurrency(totals.vat)}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums font-bold text-[#1e3a5f]">
                {formatCurrency(totals.total)}
              </td>
            </tr>
          </tfoot>
        )}
      </ReportTableShell>
    </>
  );
}
