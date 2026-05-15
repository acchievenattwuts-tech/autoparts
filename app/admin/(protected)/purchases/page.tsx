export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { Eye, Pencil, Plus } from "lucide-react";
import { PaymentMethod, PurchaseType } from "@/lib/generated/prisma";
import type { Prisma } from "@/lib/generated/prisma";
import SearchBar from "@/components/shared/SearchBar";
import PurchaseCancelButton from "./PurchaseCancelButton";
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
const purchaseTypeLabel: Record<PurchaseType, string> = {
  CASH_PURCHASE: "ซื้อสด",
  CREDIT_PURCHASE: "ซื้อเชื่อ",
};
const paymentMethodLabel: Record<PaymentMethod, string> = {
  CASH: "เงินสด",
  TRANSFER: "โอนเงิน",
  CREDIT: "เครดิต",
};


const PurchasesPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; from?: string; to?: string }>;
}) => {
  await requirePermission("purchases.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canCreate = hasPermissionAccess(role, permissions, "purchases.create");
  const canUpdate = hasPermissionAccess(role, permissions, "purchases.update");
  const canCancel = hasPermissionAccess(role, permissions, "purchases.cancel");

  const { q, page, from: fromParam, to: toParam } = await searchParams;
  const pageNum = Math.max(1, parseInt(page ?? "1", 10));

  const from = fromParam ?? "";
  const to   = toParam   ?? "";

  const where: Prisma.PurchaseWhereInput = {};
  if (from || to) {
    where.purchaseDate = {
      ...(from ? { gte: parseDateOnlyToStartOfDay(from) } : {}),
      ...(to   ? { lte: parseDateOnlyToEndOfDay(to) } : {}),
    };
  }
  if (q) {
    where.OR = [
      { purchaseNo:  { contains: q, mode: "insensitive" } },
      { referenceNo: { contains: q, mode: "insensitive" } },
      { supplier:    { name: { contains: q, mode: "insensitive" } } },
      { note:        { contains: q, mode: "insensitive" } },
    ];
  }

  const whereClause = Object.keys(where).length > 0 ? where : undefined;

  const [purchases, totalCount] = await Promise.all([
    db.purchase.findMany({
      where: whereClause,
      orderBy: [{ purchaseDate: "desc" }, { purchaseNo: "desc" }],
      take: PAGE_SIZE,
      skip: (pageNum - 1) * PAGE_SIZE,
      include: {
        supplier: { select: { name: true } },
        items:    { select: { id: true } },
      },
    }),
    db.purchase.count({ where: whereClause }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const paginationParams: Record<string, string> = {};
  if (q)    paginationParams.q    = q;
  if (from) paginationParams.from = from;
  if (to)   paginationParams.to   = to;

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="ใบซื้อสินค้า"
        description="ค้นหา ดูสถานะ และจัดการใบซื้อสินค้า"
        actions={
          canCreate ? (
            <Link href="/admin/purchases/new" className="inline-flex items-center gap-2 rounded-xl bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600">
              <Plus size={16} /> สร้างใบซื้อใหม่
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
          <SearchBar placeholder="ค้นหาเลขที่ใบซื้อ, ซัพพลายเออร์, เอกสารอ้างอิง..." />
        </div>
      </AdminFilterToolbar>

      <AdminTableSection>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-slate-300">
            <tr>
              <th className="w-10 px-4 py-3 text-center font-medium">#</th>
              <th className="px-4 py-3 text-left font-medium">เลขที่ใบซื้อ</th>
              <th className="px-4 py-3 text-left font-medium">วันที่</th>
              <th className="px-4 py-3 text-left font-medium">ซัพพลายเออร์</th>
              <th className="px-4 py-3 text-left font-medium">ประเภทการซื้อ</th>
              <th className="px-4 py-3 text-right font-medium">จำนวนรายการ</th>
              <th className="px-4 py-3 text-right font-medium">ยอดสุทธิ</th>
              <th className="px-4 py-3 text-left font-medium">สถานะ</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {purchases.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-slate-400 dark:text-slate-500">
                  {q ? `ไม่พบรายการที่ตรงกับ "${q}"` : "ยังไม่มีใบซื้อ"}
                </td>
              </tr>
            ) : (
              purchases.map((p, idx) => (
                <tr key={p.id} className={`border-t border-slate-100 transition-colors dark:border-white/5 ${p.status === "CANCELLED" ? "bg-rose-50/60 opacity-70 dark:bg-rose-400/10" : "hover:bg-slate-50/70 dark:hover:bg-white/5"}`}>
                  <td className="px-4 py-3 text-center text-xs tabular-nums text-slate-400 dark:text-slate-500">{(pageNum - 1) * PAGE_SIZE + idx + 1}</td>
                  <td className="px-4 py-3 font-mono font-medium text-[#1e3a5f] dark:text-sky-200">{p.purchaseNo}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDateThai(p.purchaseDate)}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{p.supplier?.name ?? "-"}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{purchaseTypeLabel[p.purchaseType] ?? p.purchaseType}{p.cashBankAccountId ? ` โดย ${paymentMethodLabel[p.paymentMethod] ?? p.paymentMethod}` : ""}</td>
                  <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">{p.items.length} รายการ</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900 dark:text-slate-100">{Number(p.netAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3">
                    {p.status === "CANCELLED" ? <AdminStatusBadge tone="danger">ยกเลิกแล้ว</AdminStatusBadge> : <AdminStatusBadge tone="success">ใช้งาน</AdminStatusBadge>}
                  </td>
                  <td className="px-4 py-3">
                    <AdminActionGroup align="end">
                      <Link href={`/admin/purchases/${p.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-[#1e3a5f] transition-colors hover:text-blue-700 dark:text-sky-300 dark:hover:text-sky-200">
                        <Eye size={14} /> ดู
                      </Link>
                      {p.status === "ACTIVE" ? (
                        <>
                          {canUpdate ? <Link href={`/admin/purchases/${p.id}/edit`} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"><Pencil size={14} /> แก้ไข</Link> : null}
                          {canCancel ? <PurchaseCancelButton purchaseId={p.id} docNo={p.purchaseNo} /> : null}
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

      <Pagination currentPage={pageNum} totalPages={totalPages} basePath="/admin/purchases" searchParams={paginationParams} />
    </div>
  );
};

export default PurchasesPage;
