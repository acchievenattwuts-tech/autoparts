export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import NavLink from "@/components/shared/NavLink";
import { Plus, Eye, Pencil } from "lucide-react";
import PrintFromListButton from "@/components/shared/PrintFromListButton";
import { PaymentMethod } from "@/lib/generated/prisma";
import type { Prisma } from "@/lib/generated/prisma";
import SearchBar from "@/components/shared/SearchBar";
import ReceiptCancelButton from "./ReceiptCancelButton";
import Pagination from "@/components/shared/Pagination";
import DateRangeFilter from "@/components/shared/DateRangeFilter";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminFilterToolbar from "@/components/shared/AdminFilterToolbar";
import AdminTableSection from "@/components/shared/AdminTableSection";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import AdminActionGroup from "@/components/shared/AdminActionGroup";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import {
  formatDateThai,
  parseDateOnlyToEndOfDay,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";

const PAGE_SIZE = 30;

const paymentMethodLabel: Record<PaymentMethod, string> = {
  CASH:     "เงินสด",
  TRANSFER: "โอนเงิน",
  CREDIT:   "เครดิต",
};
const paymentMethodTone = {
  CASH:     "success",
  TRANSFER: "info",
  CREDIT:   "warning",
} as const;

const ReceiptsPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; from?: string; to?: string }>;
}) => {
  await requirePermission("receipts.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canCreate = hasPermissionAccess(role, permissions, "receipts.create");
  const canUpdate = hasPermissionAccess(role, permissions, "receipts.update");
  const canCancel = hasPermissionAccess(role, permissions, "receipts.cancel");

  const { q, page, from: fromParam, to: toParam } = await searchParams;
  const pageNum = Math.max(1, parseInt(page ?? "1", 10));
  const from = fromParam ?? "";
  const to   = toParam   ?? "";

  const where: Prisma.ReceiptWhereInput = {};
  if (from || to) {
    where.receiptDate = {
      ...(from ? { gte: parseDateOnlyToStartOfDay(from) } : {}),
      ...(to   ? { lte: parseDateOnlyToEndOfDay(to) } : {}),
    };
  }
  if (q) {
    where.OR = [
      { receiptNo:    { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
      { customer:     { name: { contains: q, mode: "insensitive" } } },
      { note:         { contains: q, mode: "insensitive" } },
    ];
  }

  const whereClause = Object.keys(where).length > 0 ? where : undefined;

  const [receipts, totalCount] = await Promise.all([
    db.receipt.findMany({
      where: whereClause,
      orderBy: [{ receiptDate: "desc" }, { receiptNo: "desc" }],
      take: PAGE_SIZE,
      skip: (pageNum - 1) * PAGE_SIZE,
      include: {
        customer: { select: { name: true } },
        _count:   { select: { items: true } },
      },
    }),
    db.receipt.count({ where: whereClause }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const paginationParams: Record<string, string> = {};
  if (q)    paginationParams.q    = q;
  if (from) paginationParams.from = from;
  if (to)   paginationParams.to   = to;

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="ใบเสร็จรับเงิน"
        description="ค้นหาและตรวจสอบรายการรับชำระเงิน"
        actions={
          canCreate ? (
            <NavLink href="/admin/receipts/new" className="inline-flex items-center gap-2 rounded-xl bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600">
              <Plus size={16} /> สร้างใบเสร็จใหม่
            </NavLink>
          ) : null
        }
      />

      <AdminFilterToolbar className="mb-0" summary={q ? <span className="text-slate-500 dark:text-slate-400">ผลการค้นหา &quot;{q}&quot;: {totalCount} รายการ</span> : null}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <DateRangeFilter from={from} to={to} />
          <SearchBar placeholder="ค้นหาเลขที่ใบเสร็จ, ชื่อลูกค้า..." />
        </div>
      </AdminFilterToolbar>

      <AdminTableSection>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-slate-300">
            <tr>
              <th className="w-10 px-4 py-3 text-center font-medium">#</th>
              <th className="px-4 py-3 text-left font-medium">เลขที่ใบเสร็จ</th>
              <th className="px-4 py-3 text-left font-medium">วันที่</th>
              <th className="px-4 py-3 text-left font-medium">ลูกค้า</th>
              <th className="px-4 py-3 text-right font-medium">รายการ (ใบขาย)</th>
              <th className="px-4 py-3 text-right font-medium">ยอดรับชำระ</th>
              <th className="px-4 py-3 text-left font-medium">ช่องทาง</th>
              <th className="px-4 py-3 text-left font-medium">สถานะ</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {receipts.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-slate-400 dark:text-slate-500">
                  {q ? `ไม่พบรายการที่ตรงกับ "${q}"` : "ยังไม่มีใบเสร็จรับเงิน"}
                </td>
              </tr>
            ) : (
              receipts.map((r, idx) => (
                <tr key={r.id} className={`border-t border-slate-100 transition-colors dark:border-white/5 ${r.status === "CANCELLED" ? "bg-rose-50/60 opacity-70 dark:bg-rose-400/10" : "hover:bg-slate-50/70 dark:hover:bg-white/5"}`}>
                  <td className="px-4 py-3 text-center text-xs tabular-nums text-slate-400 dark:text-slate-500">{(pageNum - 1) * PAGE_SIZE + idx + 1}</td>
                  <td className="px-4 py-3 font-mono font-medium text-[#1e3a5f] dark:text-sky-200">{r.receiptNo}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDateThai(r.receiptDate)}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.customer?.name ?? r.customerName ?? "-"}</td>
                  <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">{r._count.items} ใบ</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900 dark:text-slate-100">{Number(r.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3"><AdminStatusBadge tone={paymentMethodTone[r.paymentMethod]}>{paymentMethodLabel[r.paymentMethod]}</AdminStatusBadge></td>
                  <td className="px-4 py-3">{r.status === "CANCELLED" ? <AdminStatusBadge tone="danger">ยกเลิกแล้ว</AdminStatusBadge> : <AdminStatusBadge tone="success">ใช้งาน</AdminStatusBadge>}</td>
                  <td className="px-4 py-3">
                    <AdminActionGroup align="end">
                      <PrintFromListButton href={`/admin/receipts/${r.id}`} />
                      <NavLink href={`/admin/receipts/${r.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-[#1e3a5f] transition-colors hover:text-blue-700 dark:text-sky-300 dark:hover:text-sky-200" hideSpinner>
                        <Eye size={14} /> ดู
                      </NavLink>
                      {r.status === "ACTIVE" ? (
                        <>
                          {canUpdate ? <NavLink href={`/admin/receipts/${r.id}/edit`} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200" hideSpinner><Pencil size={14} /> แก้ไข</NavLink> : null}
                          {canCancel ? <ReceiptCancelButton receiptId={r.id} docNo={r.receiptNo} /> : null}
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

      <Pagination currentPage={pageNum} totalPages={totalPages} basePath="/admin/receipts" searchParams={paginationParams} />
    </div>
  );
};

export default ReceiptsPage;
