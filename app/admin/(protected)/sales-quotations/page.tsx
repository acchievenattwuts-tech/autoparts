import { formatQuotationReference } from "@/lib/sales-quotation-form";
import Link from "next/link";
import { Eye, Pencil, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission, getSessionPermissionContext } from "@/lib/require-auth";
import { hasPermissionAccess } from "@/lib/access-control";
import { formatDateThai, parseDateOnlyToStartOfDay, parseDateOnlyToEndOfDay } from "@/lib/th-date";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminFilterToolbar from "@/components/shared/AdminFilterToolbar";
import AdminTableSection from "@/components/shared/AdminTableSection";
import AdminActionGroup from "@/components/shared/AdminActionGroup";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import PrintFromListButton from "@/components/shared/PrintFromListButton";
import { getAdminDocumentRowClass } from "@/lib/admin-status-presentation";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE_SIZE = 50;
/** Same control style as the products filter row (ProductAutocomplete's input). */
const filterInputCls = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/20 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500";

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<{ q?: string; from?: string; to?: string; page?: string }> }) {
  await requirePermission("sales_quotations.view");
  const { role, permissions } = await getSessionPermissionContext();
  const params = await searchParams;
  const page = Math.max(1, Math.min(100000, Number.parseInt(params.page ?? "1", 10) || 1));
  const validDate = (s?: string) => s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
  const from = validDate(params.from), to = validDate(params.to);
  const rows = await db.salesQuotation.findMany({ where: {
    ...(params.q ? { OR: [{ quotationNo: { contains: params.q, mode: "insensitive" as const } }, { customerName: { contains: params.q, mode: "insensitive" as const } }] } : {}),
    ...(from || to ? { quotationDate: { ...(from ? { gte: parseDateOnlyToStartOfDay(from) } : {}), ...(to ? { lte: parseDateOnlyToEndOfDay(to) } : {}) } } : {}),
  }, select: { id: true, quotationNo: true, revision: true, quotationDate: true, customerName: true, netAmount: true, status: true, activeSale: { select: { id: true, saleNo: true } } }, orderBy: [{ quotationDate: "desc" }, { quotationNo: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1 });
  const pageHref = (number: number) => `/admin/sales-quotations?${new URLSearchParams({ q: params.q ?? "", from: from ?? "", to: to ?? "", page: String(number) })}`;
  const visibleRows = rows.slice(0, PAGE_SIZE);
  const canCreate = hasPermissionAccess(role, permissions, "sales_quotations.create");
  const canUpdate = hasPermissionAccess(role, permissions, "sales_quotations.update");

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="ใบเสนอราคา"
        description="ค้นหา ดูรายละเอียด และจัดการใบเสนอราคาก่อนนำไปบันทึกขาย"
        actions={
          canCreate ? (
            <Link
              href="/admin/sales-quotations/new"
              className="inline-flex items-center gap-2 rounded-xl bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
            >
              <Plus size={16} /> เพิ่มใบเสนอราคา
            </Link>
          ) : null
        }
      />

      <AdminFilterToolbar className="mb-0">
        {/* The row is an inner div, never the <form> itself: AdminSearchForm always
            adds space-y-*, and on a flex row that margin-top pushes every child
            after the first out of line. Same structure as the products filter. */}
        <AdminSearchForm action="/admin/sales-quotations" method="GET" className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[200px] flex-1">
              <input
                type="text"
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="ค้นหาเลข SQ หรือชื่อลูกค้า"
                className={`w-full ${filterInputCls}`}
              />
            </div>
            <div lang="en-GB" className="flex shrink-0 items-center gap-2">
              <span className="whitespace-nowrap text-sm text-gray-500 dark:text-slate-400">ช่วงวันที่</span>
              <input type="date" name="from" defaultValue={from} className={`w-[150px] ${filterInputCls}`} />
              <span className="text-gray-400 dark:text-slate-500">–</span>
              <input type="date" name="to" defaultValue={to} className={`w-[150px] ${filterInputCls}`} />
            </div>
            <AdminSearchSubmitButton className="shrink-0 inline-flex justify-center rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055]">
              ค้นหา
            </AdminSearchSubmitButton>
            {(params.q || from || to) && (
              <Link
                href="/admin/sales-quotations"
                className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
              >
                ล้าง
              </Link>
            )}
          </div>
        </AdminSearchForm>
      </AdminFilterToolbar>

      {params.q && <p className="text-sm text-slate-500 dark:text-slate-400">ผลการค้นหา &quot;{params.q}&quot;: {visibleRows.length}{rows.length > PAGE_SIZE ? "+" : ""} รายการ</p>}

      <AdminTableSection>
        <table className="min-w-[900px] w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-slate-300">
            <tr>
              <th className="w-10 px-4 py-3 text-center font-medium">#</th>
              <th className="px-4 py-3 text-left font-medium">เลขที่</th>
              <th className="px-4 py-3 text-left font-medium">วันที่</th>
              <th className="w-[220px] px-4 py-3 text-left font-medium">ลูกค้า</th>
              <th className="px-4 py-3 text-right font-medium">ยอดสุทธิ</th>
              <th className="px-4 py-3 text-left font-medium">สถานะ</th>
              <th className="px-4 py-3 text-left font-medium">อ้างอิงใบขาย</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-slate-400 dark:text-slate-500">
                  {params.q ? `ไม่พบใบเสนอราคาที่ตรงกับ "${params.q}"` : "ยังไม่มีใบเสนอราคา"}
                </td>
              </tr>
            ) : (
              visibleRows.map((row, index) => (
                <tr key={row.id} className={`border-t border-slate-100 transition-colors dark:border-white/5 ${getAdminDocumentRowClass(row.status === "CANCELLED")}`}>
                  <td className="px-4 py-3 text-center text-xs tabular-nums text-slate-400 dark:text-slate-500">{(page - 1) * PAGE_SIZE + index + 1}</td>
                  <td className="px-4 py-3 font-mono font-medium text-[#1e3a5f] dark:text-sky-200">
                    <Link href={`/admin/sales-quotations/${row.id}`} className="hover:underline">{formatQuotationReference(row.quotationNo, row.revision)}</Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDateThai(row.quotationDate)}</td>
                  <td className="w-[220px] px-4 py-3 text-slate-600 dark:text-slate-300">{row.customerName}</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900 dark:text-slate-100">{Number(row.netAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3">
                    {row.status === "CANCELLED" ? (
                      <AdminStatusBadge tone="danger">ยกเลิกแล้ว</AdminStatusBadge>
                    ) : row.activeSale ? (
                      <AdminStatusBadge tone="info">อ้างอิงแล้ว</AdminStatusBadge>
                    ) : (
                      <AdminStatusBadge tone="success">ใช้งาน</AdminStatusBadge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {row.activeSale ? (
                      <Link href={`/admin/sales/${row.activeSale.id}`} className="font-mono text-[#1e3a5f] hover:underline dark:text-sky-300">{row.activeSale.saleNo}</Link>
                    ) : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <AdminActionGroup align="end">
                      <PrintFromListButton href={`/admin/sales-quotations/${row.id}`} />
                      <Link href={`/admin/sales-quotations/${row.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-[#1e3a5f] transition-colors hover:text-blue-700 dark:text-sky-300 dark:hover:text-sky-200">
                        <Eye size={14} /> ดู
                      </Link>
                      {row.status === "ACTIVE" && !row.activeSale && canUpdate ? (
                        <Link href={`/admin/sales-quotations/${row.id}/edit`} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                          <Pencil size={14} /> แก้ไข
                        </Link>
                      ) : null}
                    </AdminActionGroup>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </AdminTableSection>

      <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
        {page > 1 && (
          <Link href={pageHref(page - 1)} className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-medium text-slate-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/15 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-sky-500 dark:hover:text-sky-300">
            หน้าก่อน
          </Link>
        )}
        <span className="text-slate-500 dark:text-slate-400">หน้า {page}</span>
        {rows.length > PAGE_SIZE && (
          <Link href={pageHref(page + 1)} className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-medium text-slate-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/15 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-sky-500 dark:hover:text-sky-300">
            หน้าถัดไป
          </Link>
        )}
      </div>
    </div>
  );
}
