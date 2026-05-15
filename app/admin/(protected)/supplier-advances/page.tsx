export const dynamic = "force-dynamic";
export const metadata = { title: "เงินมัดจำซัพพลายเออร์" };

import Link from "next/link";
import { Eye, Pencil, Plus } from "lucide-react";
import type { Prisma } from "@/lib/generated/prisma";
import { PaymentMethod } from "@/lib/generated/prisma";
import { db } from "@/lib/db";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import DateRangeFilter from "@/components/shared/DateRangeFilter";
import Pagination from "@/components/shared/Pagination";
import SearchBar from "@/components/shared/SearchBar";
import SupplierAdvanceCancelButton from "./SupplierAdvanceCancelButton";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminFilterToolbar from "@/components/shared/AdminFilterToolbar";
import AdminTableSection from "@/components/shared/AdminTableSection";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import AdminActionGroup from "@/components/shared/AdminActionGroup";
import {
  formatDateThai,
  parseDateOnlyToEndOfDay,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";

const PAGE_SIZE = 30;

const paymentMethodLabel: Record<PaymentMethod, string> = {
  CASH: "เงินสด",
  TRANSFER: "โอนเงิน",
  CREDIT: "เครดิต",
};
const paymentMethodTone = {
  CASH:     "success",
  TRANSFER: "info",
  CREDIT:   "warning",
} as const;

const SupplierAdvancesPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; from?: string; to?: string }>;
}) => {
  await requirePermission("supplier_advances.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canCreate = hasPermissionAccess(role, permissions, "supplier_advances.create");
  const canUpdate = hasPermissionAccess(role, permissions, "supplier_advances.update");
  const canCancel = hasPermissionAccess(role, permissions, "supplier_advances.cancel");

  const { q, page, from: fromParam, to: toParam } = await searchParams;
  const pageNum = Math.max(1, parseInt(page ?? "1", 10));
  const from = fromParam ?? "";
  const to = toParam ?? "";

  const where: Prisma.SupplierAdvanceWhereInput = {};
  if (from || to) {
    where.advanceDate = {
      ...(from ? { gte: parseDateOnlyToStartOfDay(from) } : {}),
      ...(to ? { lte: parseDateOnlyToEndOfDay(to) } : {}),
    };
  }
  if (q) {
    where.OR = [
      { advanceNo: { contains: q, mode: "insensitive" } },
      { supplier: { name: { contains: q, mode: "insensitive" } } },
      { note: { contains: q, mode: "insensitive" } },
      { cashBankAccount: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const whereClause = Object.keys(where).length > 0 ? where : undefined;

  const [advances, totalCount] = await Promise.all([
    db.supplierAdvance.findMany({
      where: whereClause,
      orderBy: [{ advanceDate: "desc" }, { advanceNo: "desc" }],
      take: PAGE_SIZE,
      skip: (pageNum - 1) * PAGE_SIZE,
      include: {
        supplier: { select: { name: true } },
        cashBankAccount: { select: { name: true } },
        _count: { select: { supplierPayments: true } },
      },
    }),
    db.supplierAdvance.count({ where: whereClause }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const paginationParams: Record<string, string> = {};
  if (q) paginationParams.q = q;
  if (from) paginationParams.from = from;
  if (to) paginationParams.to = to;

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="เงินมัดจำซัพพลายเออร์"
        description="ค้นหาและจัดการเอกสารเงินมัดจำซัพพลายเออร์"
        actions={
          canCreate ? (
            <Link href="/admin/supplier-advances/new" className="inline-flex items-center gap-2 rounded-xl bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600">
              <Plus size={16} /> สร้างเอกสารใหม่
            </Link>
          ) : null
        }
      />

      <AdminFilterToolbar className="mb-0" summary={q ? <span className="text-slate-500 dark:text-slate-400">ผลการค้นหา &quot;{q}&quot;: {totalCount} รายการ</span> : null}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <DateRangeFilter from={from} to={to} />
          <SearchBar placeholder="ค้นหาเลขที่เอกสาร, ซัพพลายเออร์, บัญชีจ่ายเงิน..." />
        </div>
      </AdminFilterToolbar>

      <AdminTableSection>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-slate-300">
            <tr>
              <th className="w-10 px-4 py-3 text-center font-medium">#</th>
              <th className="px-4 py-3 text-left font-medium">เลขที่เอกสาร</th>
              <th className="px-4 py-3 text-left font-medium">วันที่</th>
              <th className="px-4 py-3 text-left font-medium">ซัพพลายเออร์</th>
              <th className="px-4 py-3 text-left font-medium">ช่องทางจ่าย</th>
              <th className="px-4 py-3 text-left font-medium">บัญชีจ่ายเงิน</th>
              <th className="px-4 py-3 text-right font-medium">ยอดมัดจำ</th>
              <th className="px-4 py-3 text-right font-medium">คงเหลือ</th>
              <th className="px-4 py-3 text-right font-medium">อ้างอิงจ่าย</th>
              <th className="px-4 py-3 text-left font-medium">สถานะ</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {advances.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-slate-400 dark:text-slate-500">
                  {q ? `ไม่พบรายการที่ตรงกับ "${q}"` : "ยังไม่มีรายการเงินมัดจำซัพพลายเออร์"}
                </td>
              </tr>
            ) : (
              advances.map((advance, index) => (
                <tr key={advance.id} className={`border-t border-slate-100 transition-colors dark:border-white/5 ${advance.status === "CANCELLED" ? "bg-rose-50/60 opacity-70 dark:bg-rose-400/10" : "hover:bg-slate-50/70 dark:hover:bg-white/5"}`}>
                  <td className="px-4 py-3 text-center text-xs tabular-nums text-slate-400 dark:text-slate-500">{(pageNum - 1) * PAGE_SIZE + index + 1}</td>
                  <td className="px-4 py-3 font-mono font-medium text-[#1e3a5f] dark:text-sky-200">{advance.advanceNo}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDateThai(advance.advanceDate)}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{advance.supplier.name}</td>
                  <td className="px-4 py-3"><AdminStatusBadge tone={paymentMethodTone[advance.paymentMethod]}>{paymentMethodLabel[advance.paymentMethod]}</AdminStatusBadge></td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{advance.cashBankAccount?.name ?? "-"}</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900 dark:text-slate-100">{Number(advance.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-right font-medium text-amber-700 dark:text-amber-300">{Number(advance.amountRemain).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">{advance._count.supplierPayments} รายการ</td>
                  <td className="px-4 py-3">{advance.status === "CANCELLED" ? <AdminStatusBadge tone="danger">ยกเลิกแล้ว</AdminStatusBadge> : <AdminStatusBadge tone="success">ใช้งาน</AdminStatusBadge>}</td>
                  <td className="px-4 py-3">
                    <AdminActionGroup align="end">
                      <Link href={`/admin/supplier-advances/${advance.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-[#1e3a5f] transition-colors hover:text-blue-700 dark:text-sky-300 dark:hover:text-sky-200"><Eye size={14} /> ดู</Link>
                      {advance.status === "ACTIVE" ? (
                        <>
                          {canUpdate ? <Link href={`/admin/supplier-advances/${advance.id}/edit`} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"><Pencil size={14} /> แก้ไข</Link> : null}
                          {canCancel ? <SupplierAdvanceCancelButton advanceId={advance.id} docNo={advance.advanceNo} /> : null}
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

      <Pagination currentPage={pageNum} totalPages={totalPages} basePath="/admin/supplier-advances" searchParams={paginationParams} />
    </div>
  );
};

export default SupplierAdvancesPage;
