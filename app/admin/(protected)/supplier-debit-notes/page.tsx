import Link from "next/link";
import type { JSX } from "react";
import { Eye, Pencil, Plus } from "lucide-react";
import type { Prisma } from "@/lib/generated/prisma";
import { db } from "@/lib/db";
import { requirePermission, getSessionPermissionContext } from "@/lib/require-auth";
import { hasPermissionAccess } from "@/lib/access-control";
import { formatDateThai, isDateOnlyString, parseDateOnlyToStartOfDay, parseDateOnlyToEndOfDay } from "@/lib/th-date";
import { getAdminDocumentRowClass } from "@/lib/admin-status-presentation";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminFilterToolbar from "@/components/shared/AdminFilterToolbar";
import AdminTableSection from "@/components/shared/AdminTableSection";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import AdminActionGroup from "@/components/shared/AdminActionGroup";
import Pagination from "@/components/shared/Pagination";

export const dynamic = "force-dynamic";
export const metadata = { title: "ใบเพิ่มหนี้ซัพพลายเออร์" };
const PAGE_SIZE = 30;
const MAX_PAGE = 100_000;
const fieldCls = "h-10 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/20 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500";
const money = (value: unknown): string => Number(value).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type ListSearchParams = Promise<{ q?: string; page?: string; from?: string; to?: string }>;

const loadDebitList = async ({ searchParams }: { searchParams: ListSearchParams }) => {
  try {
    await requirePermission("supplier_debit_notes.view");
    const { role, permissions } = await getSessionPermissionContext();
    const { q = "", page, from: fromParam, to: toParam } = await searchParams;
    const from = isDateOnlyString(fromParam) ? fromParam : "";
    const to = isDateOnlyString(toParam) ? toParam : "";
    const pageNumber = Math.max(1, Math.min(MAX_PAGE, Number.parseInt(page ?? "1", 10) || 1));
    const where: Prisma.SupplierDebitNoteWhereInput = q ? { OR: [{ debitNo: { contains: q, mode: "insensitive" as const } },
      { supplierReferenceNo: { contains: q, mode: "insensitive" as const } },
      { purchase: { purchaseNo: { contains: q, mode: "insensitive" as const } } },
      { supplier: { name: { contains: q, mode: "insensitive" as const } } }] } : {};
    if (from || to) where.postingDate = {
      ...(from ? { gte: parseDateOnlyToStartOfDay(from) } : {}),
      ...(to ? { lte: parseDateOnlyToEndOfDay(to) } : {}),
    };
    const [rows, count] = await Promise.all([
      db.supplierDebitNote.findMany({ where, orderBy: [{ postingDate: "desc" }, { debitNo: "desc" }], take: PAGE_SIZE, skip: (pageNumber - 1) * PAGE_SIZE,
        select: { id: true, debitNo: true, supplierReferenceNo: true, postingDate: true, netAmount: true,
          amountRemain: true, inventoryAmount: true, varianceAmount: true, status: true,
          supplier: { select: { name: true } }, purchase: { select: { purchaseNo: true } } } }),
      db.supplierDebitNote.count({ where }),
    ]);
    return { q, from, to, pageNumber, rows, count,
      canCreate: hasPermissionAccess(role, permissions, "supplier_debit_notes.create"),
      canUpdate: hasPermissionAccess(role, permissions, "supplier_debit_notes.update") };
  } catch (error) { console.error("[supplier-DN list]", error); throw error; }
};

const DebitListPage = async ({ searchParams }: { searchParams: ListSearchParams }): Promise<JSX.Element> => {
  const { q, from, to, pageNumber, rows, count, canCreate, canUpdate } = await loadDebitList({ searchParams });
  const filtered = Boolean(q || from || to);
  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="ใบเพิ่มหนี้ซัพพลายเออร์ (DN)"
        description="เพิ่มเจ้าหนี้และปรับมูลค่าต้นทุนโดยไม่เพิ่มจำนวนสินค้า · ส่วนที่ไม่เข้าสินค้าคงเหลือลงเป็นส่วนต่างต้นทุนงวด DN"
        actions={canCreate ? (
          <Link href="/admin/supplier-debit-notes/new" className="inline-flex items-center gap-2 rounded-xl bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600">
            <Plus size={16} /> บันทึก DN
          </Link>
        ) : null}
      />

      <AdminFilterToolbar className="mb-0"
        summary={filtered ? <span className="text-slate-500 dark:text-slate-400">ผลการค้นหา: {count} รายการ</span> : null}>
        <AdminSearchForm className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <label className="block text-sm lg:w-44"><span className="mb-1 block text-slate-600 dark:text-slate-300">วันที่ลงต้นทุน ตั้งแต่</span>
            <input type="date" name="from" defaultValue={from} className={`${fieldCls} w-full`} /></label>
          <label className="block text-sm lg:w-44"><span className="mb-1 block text-slate-600 dark:text-slate-300">ถึง</span>
            <input type="date" name="to" defaultValue={to} className={`${fieldCls} w-full`} /></label>
          <input name="q" defaultValue={q} aria-label="ค้นหา DN" placeholder="ค้นหาเลข DN, เลขของซัพพลายเออร์, ใบซื้อ, ชื่อซัพพลายเออร์..."
            className={`${fieldCls} w-full lg:flex-1`} />
          <AdminSearchSubmitButton>ค้นหา</AdminSearchSubmitButton>
        </AdminSearchForm>
      </AdminFilterToolbar>

      <AdminTableSection>
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-slate-300">
            <tr>
              <th className="w-10 px-4 py-3 text-center font-medium">#</th>
              <th className="px-4 py-3 text-left font-medium">เลขที่เอกสาร</th>
              <th className="px-4 py-3 text-left font-medium">วันที่ลงต้นทุน</th>
              <th className="px-4 py-3 text-left font-medium">ซัพพลายเออร์</th>
              <th className="px-4 py-3 text-right font-medium">เจ้าหนี้เพิ่ม</th>
              <th className="px-4 py-3 text-right font-medium">เข้าสต็อก</th>
              <th className="px-4 py-3 text-right font-medium">ส่วนต่างต้นทุน</th>
              <th className="px-4 py-3 text-right font-medium">ค้างจ่าย</th>
              <th className="px-4 py-3 text-left font-medium">สถานะ</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-12 text-center text-slate-400 dark:text-slate-500">
                {filtered ? "ไม่พบใบเพิ่มหนี้ที่ตรงกับเงื่อนไข" : "ยังไม่มีใบเพิ่มหนี้ซัพพลายเออร์"}
              </td></tr>
            ) : rows.map((row, index) => {
              const cancelled = row.status === "CANCELLED";
              return (
                <tr key={row.id} className={`border-t border-slate-100 transition-colors dark:border-white/5 ${getAdminDocumentRowClass(cancelled)}`}>
                  <td className="px-4 py-3 text-center text-xs tabular-nums text-slate-400 dark:text-slate-500">{(pageNumber - 1) * PAGE_SIZE + index + 1}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/supplier-debit-notes/${row.id}`} className="font-mono font-medium text-[#1e3a5f] hover:underline dark:text-sky-200">{row.debitNo}</Link>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{row.supplierReferenceNo} · ใบซื้อ {row.purchase.purchaseNo}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDateThai(row.postingDate)}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{row.supplier.name}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-900 dark:text-slate-100">{money(row.netAmount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{money(row.inventoryAmount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-700 dark:text-amber-400">{money(row.varianceAmount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-300">{money(row.amountRemain)}</td>
                  <td className="px-4 py-3">{cancelled ? <AdminStatusBadge tone="danger">ยกเลิกแล้ว</AdminStatusBadge>
                    : Number(row.amountRemain) === 0 ? <AdminStatusBadge tone="info">ชำระครบ</AdminStatusBadge>
                      : <AdminStatusBadge tone="success">ใช้งาน</AdminStatusBadge>}</td>
                  <td className="px-4 py-3">
                    <AdminActionGroup align="end">
                      <Link href={`/admin/supplier-debit-notes/${row.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-[#1e3a5f] transition-colors hover:text-blue-700 dark:text-sky-300 dark:hover:text-sky-200"><Eye size={14} /> ดู</Link>
                      {!cancelled && canUpdate ? <Link href={`/admin/supplier-debit-notes/${row.id}/edit`} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"><Pencil size={14} /> แก้ไข</Link> : null}
                    </AdminActionGroup>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </AdminTableSection>

      <Pagination currentPage={pageNumber} totalPages={Math.max(1, Math.ceil(count / PAGE_SIZE))} basePath="/admin/supplier-debit-notes" searchParams={{ q, from, to }} />
    </div>
  );
};
export default DebitListPage;
