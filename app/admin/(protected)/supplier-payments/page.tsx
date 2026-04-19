export const dynamic = "force-dynamic";
export const metadata = { title: "จ่ายชำระซัพพลายเออร์" };

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
import SupplierPaymentCancelButton from "./SupplierPaymentCancelButton";
import {
  formatDateThai,
  parseDateOnlyToEndOfDay,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";

const PAGE_SIZE = 30;

const paymentMethodLabel: Record<PaymentMethod, string> = {
  CASH: "เงินสด",
  TRANSFER: "โอนเงิน",
  CREDIT: "ตัดยอด",
};

const SupplierPaymentsPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; from?: string; to?: string }>;
}) => {
  await requirePermission("supplier_payments.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canCreate = hasPermissionAccess(role, permissions, "supplier_payments.create");
  const canUpdate = hasPermissionAccess(role, permissions, "supplier_payments.update");
  const canCancel = hasPermissionAccess(role, permissions, "supplier_payments.cancel");

  const { q, page, from: fromParam, to: toParam } = await searchParams;
  const pageNum = Math.max(1, parseInt(page ?? "1", 10));
  const from = fromParam ?? "";
  const to = toParam ?? "";

  const where: Prisma.SupplierPaymentWhereInput = {};
  if (from || to) {
    where.paymentDate = {
      ...(from ? { gte: parseDateOnlyToStartOfDay(from) } : {}),
      ...(to ? { lte: parseDateOnlyToEndOfDay(to) } : {}),
    };
  }
  if (q) {
    where.OR = [
      { paymentNo: { contains: q, mode: "insensitive" } },
      { supplier: { name: { contains: q, mode: "insensitive" } } },
      { note: { contains: q, mode: "insensitive" } },
      { cashBankAccount: { name: { contains: q, mode: "insensitive" } } },
      { items: { some: { purchase: { purchaseNo: { contains: q, mode: "insensitive" } } } } },
      { items: { some: { purchaseReturn: { returnNo: { contains: q, mode: "insensitive" } } } } },
      { items: { some: { advance: { advanceNo: { contains: q, mode: "insensitive" } } } } },
    ];
  }

  const whereClause = Object.keys(where).length > 0 ? where : undefined;

  const [payments, totalCount] = await Promise.all([
    db.supplierPayment.findMany({
      where: whereClause,
      orderBy: [{ paymentDate: "desc" }, { paymentNo: "desc" }],
      take: PAGE_SIZE,
      skip: (pageNum - 1) * PAGE_SIZE,
      include: {
        supplier: { select: { name: true } },
        cashBankAccount: { select: { name: true } },
        _count: { select: { items: true } },
      },
    }),
    db.supplierPayment.count({ where: whereClause }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const paginationParams: Record<string, string> = {};
  if (q) paginationParams.q = q;
  if (from) paginationParams.from = from;
  if (to) paginationParams.to = to;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">จ่ายชำระซัพพลายเออร์</h1>
        {canCreate ? (
          <Link
            href="/admin/supplier-payments/new"
            className="inline-flex items-center gap-2 rounded-lg bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
          >
            <Plus size={16} /> สร้างเอกสารใหม่
          </Link>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <DateRangeFilter from={from} to={to} />
        <SearchBar placeholder="ค้นหาเลขที่เอกสาร, ซัพพลายเออร์, ใบซื้อ, CN ซื้อ, มัดจำ..." />
      </div>

      {q ? (
        <p className="mb-3 text-sm text-gray-500">
          ผลการค้นหา &quot;{q}&quot;: {totalCount} รายการ
        </p>
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
                <th className="px-4 py-3 text-left font-medium text-gray-600">ช่องทาง</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">บัญชีจ่ายเงิน</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">ยอดจ่ายจริง</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">อ้างอิง</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">สถานะ</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-gray-400">
                    {q ? `ไม่พบรายการที่ตรงกับ "${q}"` : "ยังไม่มีรายการจ่ายชำระซัพพลายเออร์"}
                  </td>
                </tr>
              ) : (
                payments.map((payment, index) => (
                  <tr
                    key={payment.id}
                    className={`border-t border-gray-50 transition-colors ${
                      payment.status === "CANCELLED" ? "bg-red-50 opacity-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <td className="px-4 py-3 text-center text-xs tabular-nums text-gray-400">
                      {(pageNum - 1) * PAGE_SIZE + index + 1}
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-[#1e3a5f]">{payment.paymentNo}</td>
                    <td className="px-4 py-3 text-gray-600">
                    {formatDateThai(payment.paymentDate)}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{payment.supplier.name}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        {paymentMethodLabel[payment.paymentMethod]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{payment.cashBankAccount?.name ?? "-"}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {Number(payment.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{payment._count.items} รายการ</td>
                    <td className="px-4 py-3">
                      {payment.status === "CANCELLED" ? (
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
                          href={`/admin/supplier-payments/${payment.id}`}
                          className="inline-flex items-center gap-1 text-xs text-[#1e3a5f] transition-colors hover:text-blue-700"
                        >
                          <Eye size={14} /> ดู
                        </Link>
                        {payment.status === "ACTIVE" ? (
                          <>
                            {canUpdate ? (
                              <Link
                                href={`/admin/supplier-payments/${payment.id}/edit`}
                                className="inline-flex items-center gap-1 text-xs text-gray-500 transition-colors hover:text-gray-700"
                              >
                                <Pencil size={14} /> แก้ไข
                              </Link>
                            ) : null}
                            {canCancel ? (
                              <SupplierPaymentCancelButton paymentId={payment.id} docNo={payment.paymentNo} />
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
        basePath="/admin/supplier-payments"
        searchParams={paginationParams}
      />
    </div>
  );
};

export default SupplierPaymentsPage;
