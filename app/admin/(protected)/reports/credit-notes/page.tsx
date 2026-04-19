export const dynamic = "force-dynamic";

import Link from "next/link";
import { FileSpreadsheet, FileText } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import {
  buildExportQuery,
  parseReportQueryFilters,
  queryCreditNoteRows,
  statusLabel,
  type CreditNoteRow,
} from "@/lib/report-queries";
import { formatDateThai } from "@/lib/th-date";

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

function formatCurrency(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: Date) {
  return formatDateThai(value);
}

export default async function CreditNotesReportPage({ searchParams }: PageProps) {
  await requirePermission("reports.view");
  const params = await searchParams;
  const filters = parseReportQueryFilters(params);

  const [rows, accounts] = await Promise.all([
    filters.hasFilter ? queryCreditNoteRows(filters) : Promise.resolve([]),
    db.cashBankAccount.findMany({
      where: { isActive: true },
      orderBy: [{ type: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true },
    }),
  ]);

  const totalSubtotal = rows.reduce((sum, row) => sum + row.subtotalAmount, 0);
  const totalVat = rows.reduce((sum, row) => sum + row.vatAmount, 0);
  const totalAmount = rows.reduce((sum, row) => sum + row.totalAmount, 0);
  const exportQuery = buildExportQuery(filters);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-kanit text-2xl font-bold text-gray-900">Credit Note Register</h1>
        <p className="text-sm text-gray-500">
          ดูรายการเครดิตโน้ตแบบรายบรรทัด พร้อมรูปแบบการตั้งหนี้หรือคืนเงิน ช่องทางคืนเงิน และบัญชีที่กระทบจริง
        </p>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          ตั้งแต่วันที่
          <input
            type="date"
            name="from"
            defaultValue={filters.fromStr}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          ถึงวันที่
          <input
            type="date"
            name="to"
            defaultValue={filters.toStr}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          ประเภทเครดิตโน้ต
          <select
            name="cnType"
            defaultValue={filters.cnType ?? "ALL"}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="ALL">ทั้งหมด</option>
            <option value="RETURN">คืนสินค้า</option>
            <option value="DISCOUNT">ส่วนลด</option>
            <option value="OTHER">อื่นๆ</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          บัญชีที่กระทบเงิน
          <select
            name="accountId"
            defaultValue={filters.accountId ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">ทุกบัญชี</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} - {account.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mb-1 flex items-center gap-2 self-end text-sm text-gray-600">
          <input
            type="checkbox"
            name="showCancelled"
            value="1"
            defaultChecked={filters.showCancelled}
            className="h-4 w-4 rounded border-gray-300"
          />
          รวมที่ยกเลิก
        </label>
        <button
          type="submit"
          className="h-9 self-end rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055]"
        >
          แสดงรายงาน
        </button>
        <Link
          href="/admin/reports/credit-notes"
          className="inline-flex h-9 items-center self-end rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200"
        >
          ล้าง
        </Link>
        <div className="ml-auto flex gap-2 self-end">
          <Link
            href={`/admin/reports/export?type=credit-notes&${exportQuery}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-gray-600 px-3 text-sm font-medium text-white hover:bg-gray-700"
          >
            <FileText size={14} />
            CSV
          </Link>
          <Link
            href={`/admin/reports/export-excel?type=credit-notes&${exportQuery}`}
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
      ) : (
      <>
      <p className="text-sm text-gray-500">
        แสดง <span className="font-semibold text-gray-900">{rows.length}</span> รายการ
        {rows.length >= 2000 && " (จำกัด 2,000 รายการ)"}
      </p>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-[#1e3a5f] text-white">
            <tr>
              <th className="w-10 px-3 py-2.5 text-center font-medium">#</th>
              <th className="px-3 py-2.5 text-left font-medium">เลขที่ CN</th>
              <th className="px-3 py-2.5 text-left font-medium">วันที่</th>
              <th className="px-3 py-2.5 text-left font-medium">อ้างอิงใบขาย</th>
              <th className="px-3 py-2.5 text-left font-medium">รหัสลูกค้า</th>
              <th className="px-3 py-2.5 text-left font-medium">ชื่อลูกค้า</th>
              <th className="px-3 py-2.5 text-left font-medium">ประเภท CN</th>
              <th className="px-3 py-2.5 text-left font-medium">รูปแบบการชดเชย</th>
              <th className="px-3 py-2.5 text-left font-medium">ช่องทางคืนเงิน</th>
              <th className="px-3 py-2.5 text-left font-medium">บัญชีเงิน</th>
              <th className="px-3 py-2.5 text-center font-medium">สถานะ</th>
              <th className="px-3 py-2.5 text-left font-medium">รหัสสินค้า</th>
              <th className="px-3 py-2.5 text-left font-medium">ชื่อสินค้า / รายละเอียด</th>
              <th className="px-3 py-2.5 text-right font-medium">จำนวน</th>
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
            {rows.map((row: CreditNoteRow) => (
              <tr
                key={`${row.docNo}-${row.rowNo}`}
                className={`transition-colors hover:bg-gray-50 ${row.status === "CANCELLED" ? "opacity-50 line-through" : ""}`}
              >
                <td className="px-3 py-2 text-center tabular-nums text-gray-400">{row.rowNo}</td>
                <td className="px-3 py-2 font-mono text-xs font-medium text-[#1e3a5f]">{row.docNo}</td>
                <td className="px-3 py-2 whitespace-nowrap">{formatDate(row.docDate)}</td>
                <td className="px-3 py-2 font-mono text-xs text-gray-500">{row.refSaleNo || "-"}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.customerCode}</td>
                <td className="px-3 py-2">{row.customerName}</td>
                <td className="px-3 py-2">{row.cnType}</td>
                <td className="px-3 py-2">{row.settlement}</td>
                <td className="px-3 py-2">{row.paymentMethod}</td>
                <td className="px-3 py-2 text-gray-600">{row.accountName}</td>
                <td className="px-3 py-2 text-center">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      row.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                    }`}
                  >
                    {statusLabel(row.status)}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{row.productCode || "-"}</td>
                <td className="px-3 py-2">
                  {row.productName || <span className="italic text-gray-400">{row.detail || "-"}</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.qty > 0 ? row.qty.toLocaleString("th-TH", { maximumFractionDigits: 4 }) : "-"}
                </td>
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
                  {formatCurrency(totalSubtotal)}
                </td>
                <td />
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                  {formatCurrency(totalVat)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-bold text-[#1e3a5f]">
                  {formatCurrency(totalAmount)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      </>
      )}
    </div>
  );
}
