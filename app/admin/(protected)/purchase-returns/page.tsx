export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { Plus, Eye, Pencil } from "lucide-react";
import type { Prisma } from "@/lib/generated/prisma";
import SearchBar from "@/components/shared/SearchBar";
import PurchaseReturnCancelButton from "./PurchaseReturnCancelButton";
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

const PurchaseReturnsPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; from?: string; to?: string }>;
}) => {
  await requirePermission("purchase_returns.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canCreate = hasPermissionAccess(role, permissions, "purchase_returns.create");
  const canUpdate = hasPermissionAccess(role, permissions, "purchase_returns.update");
  const canCancel = hasPermissionAccess(role, permissions, "purchase_returns.cancel");

  const { q, page, from: fromParam, to: toParam } = await searchParams;
  const pageNum = Math.max(1, parseInt(page ?? "1", 10));
  const from = fromParam ?? "";
  const to   = toParam   ?? "";

  const where: Prisma.PurchaseReturnWhereInput = {};
  if (from || to) {
    where.returnDate = {
      ...(from ? { gte: parseDateOnlyToStartOfDay(from) } : {}),
      ...(to   ? { lte: parseDateOnlyToEndOfDay(to) } : {}),
    };
  }
  if (q) {
    where.OR = [
      { returnNo:  { contains: q, mode: "insensitive" } },
      { supplier:  { name: { contains: q, mode: "insensitive" } } },
      { note:      { contains: q, mode: "insensitive" } },
    ];
  }

  const whereClause = Object.keys(where).length > 0 ? where : undefined;

  const [returns, totalCount] = await Promise.all([
    db.purchaseReturn.findMany({
      where: whereClause,
      orderBy: [{ returnDate: "desc" }, { returnNo: "desc" }],
      take: PAGE_SIZE,
      skip: (pageNum - 1) * PAGE_SIZE,
      include: {
        supplier: { select: { name: true } },
        _count:   { select: { items: true } },
      },
    }),
    db.purchaseReturn.count({ where: whereClause }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const paginationParams: Record<string, string> = {};
  if (q)    paginationParams.q    = q;
  if (from) paginationParams.from = from;
  if (to)   paginationParams.to   = to;

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="คืนสินค้าให้ซัพพลายเออร์"
        description="ค้นหา ดูรายละเอียด และจัดการเอกสารคืนสินค้า"
        actions={
          canCreate ? (
            <Link
              href="/admin/purchase-returns/new"
              className="inline-flex items-center gap-2 rounded-xl bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
            >
              <Plus size={16} /> บันทึกคืนสินค้าใหม่
            </Link>
          ) : null
        }
      />

      <AdminFilterToolbar
        className="mb-0"
        summary={q ? <span className="text-slate-500 dark:text-slate-400">ผลการค้นหา &quot;{q}&quot;: {totalCount} รายการ</span> : null}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <DateRangeFilter from={from} to={to} />
          <SearchBar placeholder="ค้นหาเลขที่ใบคืน, ซัพพลายเออร์..." />
        </div>
      </AdminFilterToolbar>

      <AdminTableSection>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-slate-300">
            <tr>
              <th className="w-10 px-4 py-3 text-center font-medium">#</th>
              <th className="px-4 py-3 text-left font-medium">เลขที่</th>
              <th className="px-4 py-3 text-left font-medium">วันที่</th>
              <th className="px-4 py-3 text-left font-medium">ซัพพลายเออร์</th>
              <th className="px-4 py-3 text-right font-medium">รายการ</th>
              <th className="px-4 py-3 text-right font-medium">ยอดรวม</th>
              <th className="px-4 py-3 text-left font-medium">สถานะ</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {returns.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-slate-400 dark:text-slate-500">
                  {q ? `ไม่พบรายการที่ตรงกับ "${q}"` : "ยังไม่มีรายการคืนสินค้า"}
                </td>
              </tr>
            ) : (
              returns.map((r, idx) => (
                <tr
                  key={r.id}
                  className={`border-t border-slate-100 transition-colors dark:border-white/5 ${
                    getAdminDocumentRowClass(r.status === "CANCELLED")
                  }`}
                >
                  <td className="px-4 py-3 text-center text-xs tabular-nums text-slate-400 dark:text-slate-500">{(pageNum - 1) * PAGE_SIZE + idx + 1}</td>
                  <td className="px-4 py-3 font-mono font-medium text-[#1e3a5f] dark:text-sky-200">{r.returnNo}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDateThai(r.returnDate)}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{r.supplier?.name ?? "-"}</td>
                  <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">{r._count.items} รายการ</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900 dark:text-slate-100">
                    {Number(r.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3">
                    {r.status === "CANCELLED" ? (
                      <AdminStatusBadge tone="danger">ยกเลิกแล้ว</AdminStatusBadge>
                    ) : (
                      <AdminStatusBadge tone="success">ใช้งาน</AdminStatusBadge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <AdminActionGroup align="end">
                      <Link
                        href={`/admin/purchase-returns/${r.id}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#1e3a5f] transition-colors hover:text-blue-700 dark:text-sky-300 dark:hover:text-sky-200"
                      >
                        <Eye size={14} /> ดู
                      </Link>
                      {r.status === "ACTIVE" && (
                        <>
                          {canUpdate ? (
                            <Link
                              href={`/admin/purchase-returns/${r.id}/edit`}
                              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                            >
                              <Pencil size={14} /> แก้ไข
                            </Link>
                          ) : null}
                          {canCancel ? <PurchaseReturnCancelButton returnId={r.id} docNo={r.returnNo} /> : null}
                        </>
                      )}
                    </AdminActionGroup>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </AdminTableSection>

      <Pagination currentPage={pageNum} totalPages={totalPages} basePath="/admin/purchase-returns" searchParams={paginationParams} />
    </div>
  );
};

export default PurchaseReturnsPage;
