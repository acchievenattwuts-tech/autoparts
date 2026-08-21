import Link from "next/link";
import { Eye, Pencil, Plus } from "lucide-react";
import AdvanceRefundCancelButton from "@/components/admin/AdvanceRefundCancelButton";
import AdminActionGroup from "@/components/shared/AdminActionGroup";
import AdminFilterToolbar from "@/components/shared/AdminFilterToolbar";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import AdminTableSection from "@/components/shared/AdminTableSection";
import Pagination from "@/components/shared/Pagination";
import PrintFromListButton from "@/components/shared/PrintFromListButton";
import { getAdminDocumentRowClass } from "@/lib/admin-status-presentation";
import { formatDateThai } from "@/lib/th-date";

export type AdvanceRefundListRow = {
  id: string;
  refundNo: string;
  refundDate: Date;
  refundAmount: number;
  partyName: string;
  sourceAdvanceNo: string;
  sourceAdvanceId: string;
  accountName: string | null;
  status: "ACTIVE" | "CANCELLED";
};

export default function AdvanceRefundList({
  side,
  rows,
  totalCount,
  page,
  totalPages,
  q,
  from,
  to,
  canCreate,
  canUpdate,
  canCancel,
}: {
  side: "CUSTOMER" | "SUPPLIER";
  rows: AdvanceRefundListRow[];
  totalCount: number;
  page: number;
  totalPages: number;
  q: string;
  from: string;
  to: string;
  canCreate: boolean;
  canUpdate: boolean;
  canCancel: boolean;
}) {
  const isCustomer = side === "CUSTOMER";
  const title = isCustomer
    ? "คืนเงินมัดจำลูกค้า"
    : "รับคืนเงินมัดจำซัพพลายเออร์";
  const basePath = isCustomer
    ? "/admin/customer-advance-refunds"
    : "/admin/supplier-advance-refunds";
  const paginationParams: Record<string, string> = {};
  if (q) paginationParams.q = q;
  if (from) paginationParams.from = from;
  if (to) paginationParams.to = to;
  return (
    <div className="space-y-4">
      <AdminPageHeader
        title={title}
        description={`ค้นหาและจัดการเอกสาร${title}`}
        actions={
          canCreate ? (
            <Link
              href={`${basePath}/new`}
              className="inline-flex items-center gap-2 rounded-xl bg-[#f97316] px-4 py-2 text-sm font-medium text-white hover:bg-orange-600"
            >
              <Plus size={16} /> สร้างเอกสารใหม่
            </Link>
          ) : null
        }
      />
      <AdminFilterToolbar
        summary={
          q ? (
            <span className="text-slate-500 dark:text-slate-400">
              ผลการค้นหา &quot;{q}&quot;: {totalCount} รายการ
            </span>
          ) : null
        }
      >
        <AdminSearchForm
          action={basePath}
          className="grid gap-3 md:grid-cols-[1fr_160px_160px_auto] md:items-end"
        >
          <label className="text-sm text-slate-600 dark:text-slate-300">
            ค้นหา
            <input
              name="q"
              defaultValue={q}
              placeholder="เลขที่ CN, เลขที่มัดจำ, ชื่อลูกค้า/ซัพพลายเออร์..."
              className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 dark:border-white/20 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            จากวันที่
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 dark:border-white/20 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
          <label className="text-sm text-slate-600 dark:text-slate-300">
            ถึงวันที่
            <input
              type="date"
              name="to"
              defaultValue={to}
              className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 dark:border-white/20 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
          <AdminSearchSubmitButton>ค้นหา</AdminSearchSubmitButton>
        </AdminSearchForm>
      </AdminFilterToolbar>
      <AdminTableSection>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-slate-300">
            <tr>
              <th className="px-4 py-3 text-center">#</th>
              <th className="px-4 py-3 text-left">เลขที่ CN</th>
              <th className="px-4 py-3 text-left">วันที่</th>
              <th className="px-4 py-3 text-left">
                {isCustomer ? "ลูกค้า" : "ซัพพลายเออร์"}
              </th>
              <th className="px-4 py-3 text-left">เอกสารมัดจำต้นทาง</th>
              <th className="px-4 py-3 text-left">
                บัญชี{isCustomer ? "จ่าย" : "รับ"}เงิน
              </th>
              <th className="px-4 py-3 text-right">ยอดคืน</th>
              <th className="px-4 py-3 text-left">สถานะ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, index) => (
                <tr
                  key={row.id}
                  className={`border-t border-slate-100 dark:border-white/5 ${getAdminDocumentRowClass(row.status === "CANCELLED")}`}
                >
                  <td className="px-4 py-3 text-center text-xs text-slate-400">
                    {(page - 1) * 30 + index + 1}
                  </td>
                  <td className="px-4 py-3 font-mono font-medium text-[#1e3a5f] dark:text-sky-200">
                    {row.refundNo}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {formatDateThai(row.refundDate)}
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                    {row.partyName}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`${isCustomer ? "/admin/customer-advances" : "/admin/supplier-advances"}/${row.sourceAdvanceId}`}
                      className="font-mono text-[#1e3a5f] dark:text-sky-300"
                    >
                      {row.sourceAdvanceNo}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {row.accountName ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900 dark:text-slate-100">
                    {row.refundAmount.toLocaleString("th-TH", {
                      minimumFractionDigits: 2,
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <AdminStatusBadge
                      tone={row.status === "ACTIVE" ? "success" : "danger"}
                    >
                      {row.status === "ACTIVE" ? "ใช้งาน" : "ยกเลิกแล้ว"}
                    </AdminStatusBadge>
                  </td>
                  <td className="px-4 py-3">
                    <AdminActionGroup align="end">
                      {isCustomer ? (
                        <PrintFromListButton href={`${basePath}/${row.id}`} />
                      ) : null}
                      <Link
                        href={`${basePath}/${row.id}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#1e3a5f] dark:text-sky-300"
                      >
                        <Eye size={14} /> ดู
                      </Link>
                      {row.status === "ACTIVE" && canUpdate ? (
                        <Link
                          href={`${basePath}/${row.id}/edit`}
                          className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"
                        >
                          <Pencil size={14} /> แก้ไข
                        </Link>
                      ) : null}
                      {row.status === "ACTIVE" && canCancel ? (
                        <AdvanceRefundCancelButton
                          side={side}
                          refundId={row.id}
                          docNo={row.refundNo}
                        />
                      ) : null}
                    </AdminActionGroup>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-12 text-center text-slate-400 dark:text-slate-500"
                >
                  ยังไม่มีรายการ{title}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </AdminTableSection>
      <Pagination
        currentPage={page}
        totalPages={totalPages}
        basePath={basePath}
        searchParams={paginationParams}
      />
    </div>
  );
}
