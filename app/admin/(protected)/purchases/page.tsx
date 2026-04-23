export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { Plus, Eye, Pencil } from "lucide-react";
import { PaymentMethod, PurchaseType } from "@/lib/generated/prisma";
import type { Prisma } from "@/lib/generated/prisma";
import SearchBar from "@/components/shared/SearchBar";
import PurchaseCancelButton from "./PurchaseCancelButton";
import Pagination from "@/components/shared/Pagination";
import DateRangeFilter from "@/components/shared/DateRangeFilter";
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
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">ใบซื้อสินค้า</h1>
        {canCreate ? (
          <Link href="/admin/purchases/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors">
            <Plus size={16} /> สร้างใบซื้อใหม่
          </Link>
        ) : null}
      </div>

      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <DateRangeFilter from={from} to={to} />
        <SearchBar placeholder="ค้นหาเลขที่ใบซื้อ, ซัพพลายเออร์, เอกสารอ้างอิง..." />
      </div>

      {q && (
        <p className="text-sm text-gray-500 mb-3">ผลการค้นหา &quot;{q}&quot;: {totalCount} รายการ</p>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-center py-3 px-4 font-medium text-gray-600 w-10">#</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">เลขที่ใบซื้อ</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">วันที่</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ซัพพลายเออร์</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ประเภทการซื้อ</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">จำนวนรายการ</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">ยอดสุทธิ</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">สถานะ</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody>
              {purchases.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-gray-400">
                    {q ? `ไม่พบรายการที่ตรงกับ "${q}"` : "ยังไม่มีใบซื้อ"}
                  </td>
                </tr>
              ) : (
                purchases.map((p, idx) => (
                  <tr key={p.id}
                    className={`border-t border-gray-50 transition-colors ${
                      p.status === "CANCELLED" ? "opacity-50 bg-red-50" : "hover:bg-gray-50"
                    }`}>
                    <td className="py-3 px-4 text-center text-gray-400 text-xs tabular-nums">{(pageNum - 1) * PAGE_SIZE + idx + 1}</td>
                    <td className="py-3 px-4 font-mono text-[#1e3a5f] font-medium">{p.purchaseNo}</td>
                    <td className="py-3 px-4 text-gray-600">
                    {formatDateThai(p.purchaseDate)}
                    </td>
                    <td className="py-3 px-4 text-gray-600">{p.supplier?.name ?? "-"}</td>
                    <td className="py-3 px-4 text-gray-600">
                      {purchaseTypeLabel[p.purchaseType] ?? p.purchaseType}
                      {p.cashBankAccountId ? ` โดย ${paymentMethodLabel[p.paymentMethod] ?? p.paymentMethod}` : ""}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-600">{p.items.length} รายการ</td>
                    <td className="py-3 px-4 text-right font-medium text-gray-900">
                      {Number(p.netAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4">
                      {p.status === "CANCELLED" ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                          ยกเลิกแล้ว
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                          ใช้งาน
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2 justify-end">
                        <Link href={`/admin/purchases/${p.id}`}
                          className="inline-flex items-center gap-1 text-xs text-[#1e3a5f] hover:text-blue-700 transition-colors">
                          <Eye size={14} /> ดู
                        </Link>
                        {p.status === "ACTIVE" && (
                          <>
                            {canUpdate ? (
                              <Link href={`/admin/purchases/${p.id}/edit`}
                                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors">
                                <Pencil size={14} /> แก้ไข
                              </Link>
                            ) : null}
                            {canCancel ? <PurchaseCancelButton purchaseId={p.id} docNo={p.purchaseNo} /> : null}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        currentPage={pageNum}
        totalPages={totalPages}
        basePath="/admin/purchases"
        searchParams={paginationParams}
      />
    </div>
  );
};

export default PurchasesPage;
