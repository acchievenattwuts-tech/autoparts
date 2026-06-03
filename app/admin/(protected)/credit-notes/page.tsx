export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import NavLink from "@/components/shared/NavLink";
import { Plus, Eye, Pencil } from "lucide-react";
import { CNRefundMethod, CNSettlementType, CreditNoteType } from "@/lib/generated/prisma";
import type { Prisma } from "@/lib/generated/prisma";
import SearchBar from "@/components/shared/SearchBar";
import CreditNoteCancelButton from "./CreditNoteCancelButton";
import Pagination from "@/components/shared/Pagination";
import DateRangeFilter from "@/components/shared/DateRangeFilter";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminFilterToolbar from "@/components/shared/AdminFilterToolbar";
import AdminTableSection from "@/components/shared/AdminTableSection";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import AdminActionGroup from "@/components/shared/AdminActionGroup";
import { getAdminDocumentRowClass } from "@/lib/admin-status-presentation";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import {
  formatDateThai,
  parseDateOnlyToEndOfDay,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";

const PAGE_SIZE = 30;

const cnTypeLabel: Record<CreditNoteType, string> = {
  RETURN:   "รับคืนสินค้า",
  DISCOUNT: "ลดราคา",
  OTHER:    "อื่นๆ",
};

const settlementTypeLabel: Record<CNSettlementType, string> = {
  CASH_REFUND: "คืนเงินสด",
  CREDIT_DEBT: "ตั้งหนี้",
};

const settlementTypeTone = {
  CASH_REFUND: "success",
  CREDIT_DEBT: "warning",
} as const;

const CreditNotesPage = async ({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;
    from?: string;
    to?: string;
    customerId?: string;
    productId?: string;
  }>;
}) => {
  await requirePermission("credit_notes.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canCreate = hasPermissionAccess(role, permissions, "credit_notes.create");
  const canUpdate = hasPermissionAccess(role, permissions, "credit_notes.update");
  const canCancel = hasPermissionAccess(role, permissions, "credit_notes.cancel");

  const { q, page, from: fromParam, to: toParam, customerId, productId } = await searchParams;
  const pageNum = Math.max(1, parseInt(page ?? "1", 10));
  const from = fromParam ?? "";
  const to   = toParam   ?? "";

  const where: Prisma.CreditNoteWhereInput = {};
  if (from || to) {
    where.cnDate = {
      ...(from ? { gte: parseDateOnlyToStartOfDay(from) } : {}),
      ...(to   ? { lte: parseDateOnlyToEndOfDay(to) } : {}),
    };
  }
  if (customerId) {
    where.customerId = customerId;
  }
  if (productId) {
    where.items = { some: { productId } };
  }
  if (q) {
    where.OR = [
      { cnNo:         { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
      { customer:     { name: { contains: q, mode: "insensitive" } } },
      { note:         { contains: q, mode: "insensitive" } },
    ];
  }

  const whereClause = Object.keys(where).length > 0 ? where : undefined;

  const [creditNotes, totalCount, selectedCustomer, selectedProduct] = await Promise.all([
    db.creditNote.findMany({
      where: whereClause,
      orderBy: [{ cnDate: "desc" }, { cnNo: "desc" }],
      take: PAGE_SIZE,
      skip: (pageNum - 1) * PAGE_SIZE,
      select: {
        id:             true,
        cnNo:           true,
        cnDate:         true,
        type:           true,
        settlementType: true,
        refundMethod:   true,
        totalAmount:    true,
        status:         true,
        sale: { select: { saleNo: true } },
        _count: { select: { items: true } },
      },
    }),
    db.creditNote.count({ where: whereClause }),
    customerId
      ? db.customer.findUnique({
          where: { id: customerId },
          select: { id: true, name: true, code: true },
        })
      : Promise.resolve(null),
    productId
      ? db.product.findUnique({
          where: { id: productId },
          select: { id: true, name: true, code: true },
        })
      : Promise.resolve(null),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const paginationParams: Record<string, string> = {};
  if (q)    paginationParams.q    = q;
  if (from) paginationParams.from = from;
  if (to)   paginationParams.to   = to;
  if (customerId) paginationParams.customerId = customerId;
  if (productId) paginationParams.productId = productId;

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="ใบลดหนี้ (Credit Note)"
        description="ค้นหา ดูรายละเอียด และจัดการใบลดหนี้"
        actions={
          canCreate ? (
            <NavLink href="/admin/credit-notes/new" className="inline-flex items-center gap-2 rounded-xl bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600">
              <Plus size={16} /> สร้าง CN ใหม่
            </NavLink>
          ) : null
        }
      />

      <AdminFilterToolbar
        className="mb-0"
        summary={
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-700 dark:text-slate-200">กำลังแสดงผลของ:</span>
            {selectedCustomer ? <AdminStatusBadge tone="info">ลูกค้า: {selectedCustomer.name} {selectedCustomer.code ? `(${selectedCustomer.code})` : ""}</AdminStatusBadge> : null}
            {selectedProduct ? <AdminStatusBadge tone="info">สินค้า: {selectedProduct.name} {selectedProduct.code ? `(${selectedProduct.code})` : ""}</AdminStatusBadge> : null}
            {(selectedCustomer || selectedProduct) && <NavLink href="/admin/credit-notes" className="text-sm font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-300" hideSpinner>ล้าง filter drilldown</NavLink>}
          </div>
        }
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <DateRangeFilter from={from} to={to} />
          <SearchBar placeholder="ค้นหาเลขที่ CN, ชื่อลูกค้า..." />
        </div>
      </AdminFilterToolbar>

      <AdminTableSection>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-slate-300">
            <tr>
              <th className="w-10 px-4 py-3 text-center font-medium">#</th>
              <th className="px-4 py-3 text-left font-medium">เลขที่ CN</th>
              <th className="px-4 py-3 text-left font-medium">วันที่</th>
              <th className="px-4 py-3 text-left font-medium">ประเภท</th>
              <th className="px-4 py-3 text-left font-medium">การชำระ CN</th>
              <th className="px-4 py-3 text-left font-medium">อ้างอิงใบขาย</th>
              <th className="px-4 py-3 text-right font-medium">รายการ</th>
              <th className="px-4 py-3 text-right font-medium">ยอดรวม</th>
              <th className="px-4 py-3 text-left font-medium">สถานะ</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {creditNotes.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-slate-400 dark:text-slate-500">
                  {q ? `ไม่พบรายการที่ตรงกับ "${q}"` : "ยังไม่มีรายการ Credit Note"}
                </td>
              </tr>
            ) : (
              creditNotes.map((cn, idx) => (
                <tr key={cn.id} className={`border-t border-slate-100 transition-colors dark:border-white/5 ${getAdminDocumentRowClass(cn.status === "CANCELLED")}`}>
                  <td className="px-4 py-3 text-center text-xs tabular-nums text-slate-400 dark:text-slate-500">{(pageNum - 1) * PAGE_SIZE + idx + 1}</td>
                  <td className="px-4 py-3 font-mono font-medium text-[#1e3a5f] dark:text-sky-200">{cn.cnNo}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDateThai(cn.cnDate)}</td>
                  <td className="px-4 py-3"><AdminStatusBadge tone={cn.type === CreditNoteType.RETURN ? "info" : "warning"}>{cnTypeLabel[cn.type]}</AdminStatusBadge></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <AdminStatusBadge tone={settlementTypeTone[cn.settlementType]}>{settlementTypeLabel[cn.settlementType]}</AdminStatusBadge>
                      {cn.refundMethod ? <span className="text-xs text-slate-400 dark:text-slate-500">({cn.refundMethod === CNRefundMethod.CASH ? "เงินสด" : "โอนเงิน"})</span> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{cn.sale ? <span className="font-mono text-xs">{cn.sale.saleNo}</span> : "-"}</td>
                  <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">{cn._count.items} รายการ</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900 dark:text-slate-100">{Number(cn.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3">{cn.status === "CANCELLED" ? <AdminStatusBadge tone="danger">ยกเลิกแล้ว</AdminStatusBadge> : <AdminStatusBadge tone="success">ใช้งาน</AdminStatusBadge>}</td>
                  <td className="px-4 py-3">
                    <AdminActionGroup align="end">
                      <NavLink href={`/admin/credit-notes/${cn.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-[#1e3a5f] transition-colors hover:text-blue-700 dark:text-sky-300 dark:hover:text-sky-200" hideSpinner><Eye size={14} /> ดู</NavLink>
                      {cn.status === "ACTIVE" ? (
                        <>
                          {canUpdate ? <NavLink href={`/admin/credit-notes/${cn.id}/edit`} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200" hideSpinner><Pencil size={14} /> แก้ไข</NavLink> : null}
                          {canCancel ? <CreditNoteCancelButton cnId={cn.id} docNo={cn.cnNo} /> : null}
                        </>
                      ) : null}
                    </AdminActionGroup>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </AdminTableSection>

      <Pagination currentPage={pageNum} totalPages={totalPages} basePath="/admin/credit-notes" searchParams={paginationParams} />
    </div>
  );
};

export default CreditNotesPage;
