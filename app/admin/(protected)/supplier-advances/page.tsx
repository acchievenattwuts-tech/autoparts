export const dynamic = "force-dynamic";

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

const PAGE_SIZE = 30;

const paymentMethodLabel: Record<PaymentMethod, string> = {
  CASH: "เงินสด",
  TRANSFER: "โอนเงิน",
  CREDIT: "เครดิต",
};

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
      ...(from ? { gte: new Date(`${from}T00:00:00`) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59.999`) } : {}),
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
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">เงินมัดจำซัพพลายเออร์</h1>
        {canCreate ? (
          <Link
            href="/admin/supplier-advances/new"
            className="inline-flex items-center gap-2 rounded-lg bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
          >
            <Plus size={16} /> สร้างเอกสารใหม่
          </Link>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <DateRangeFilter from={from} to={to} />
        <SearchBar placeholder="ค้นหาเลขที่เอกสาร, ซัพพลายเออร์, บัญชีจ่ายเงิน..." />
      </div>

      {q ? (
        <p className="mb-3 text-sm text-gray-500">ผลการค้นหา &quot;{q}&quot;: {totalCount} รายการ</p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-10 px-4 py-3 text-center font-medium text-gray-600">#</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">เลขที่เอกสาร</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">วันที่</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">ซัพพลายเออร์</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">ช่องทางจ่าย</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">บัญชีจ่ายเงิน</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">ยอดมัดจำ</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">คงเหลือ</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">อ้างอิงจ่าย</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">สถานะ</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {advances.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-gray-400">
                    {q ? `ไม่พบรายการที่ตรงกับ "${q}"` : "ยังไม่มีรายการเงินมัดจำซัพพลายเออร์"}
                  </td>
                </tr>
              ) : (
                advances.map((advance, index) => (
                  <tr
                    key={advance.id}
                    className={`border-t border-gray-50 transition-colors ${
                      advance.status === "CANCELLED" ? "bg-red-50 opacity-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <td className="px-4 py-3 text-center text-xs tabular-nums text-gray-400">
                      {(pageNum - 1) * PAGE_SIZE + index + 1}
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-[#1e3a5f]">{advance.advanceNo}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {new Date(advance.advanceDate).toLocaleDateString("th-TH-u-ca-gregory", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{advance.supplier.name}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        {paymentMethodLabel[advance.paymentMethod]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{advance.cashBankAccount?.name ?? "-"}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {Number(advance.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-amber-700">
                      {Number(advance.amountRemain).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {advance._count.supplierPayments} รายการ
                    </td>
                    <td className="px-4 py-3">
                      {advance.status === "CANCELLED" ? (
                        <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          ยกเลิกแล้ว
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          ใช้งาน
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/admin/supplier-advances/${advance.id}`}
                          className="inline-flex items-center gap-1 text-xs text-[#1e3a5f] transition-colors hover:text-blue-700"
                        >
                          <Eye size={14} /> ดู
                        </Link>
                        {advance.status === "ACTIVE" ? (
                          <>
                            {canUpdate ? (
                              <Link
                                href={`/admin/supplier-advances/${advance.id}/edit`}
                                className="inline-flex items-center gap-1 text-xs text-gray-500 transition-colors hover:text-gray-700"
                              >
                                <Pencil size={14} /> แก้ไข
                              </Link>
                            ) : null}
                            {canCancel ? (
                              <SupplierAdvanceCancelButton advanceId={advance.id} docNo={advance.advanceNo} />
                            ) : null}
                          </>
                        ) : null}
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
        basePath="/admin/supplier-advances"
        searchParams={paginationParams}
      />
    </div>
  );
};

export default SupplierAdvancesPage;
