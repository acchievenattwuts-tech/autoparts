export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { Plus, Eye, Pencil } from "lucide-react";
import { CNRefundMethod, CNSettlementType, CreditNoteType } from "@/lib/generated/prisma";
import type { Prisma } from "@/lib/generated/prisma";
import SearchBar from "@/components/shared/SearchBar";
import CreditNoteCancelButton from "./CreditNoteCancelButton";
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

const cnTypeLabel: Record<CreditNoteType, string> = {
  RETURN:   "รับคืนสินค้า",
  DISCOUNT: "ลดราคา",
  OTHER:    "อื่นๆ",
};

const settlementTypeLabel: Record<CNSettlementType, string> = {
  CASH_REFUND: "คืนเงินสด",
  CREDIT_DEBT: "ตั้งหนี้",
};

const settlementTypeBadge: Record<CNSettlementType, string> = {
  CASH_REFUND: "bg-emerald-100 text-emerald-700",
  CREDIT_DEBT: "bg-orange-100 text-orange-700",
};

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
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">ใบลดหนี้ (Credit Note)</h1>
        {canCreate ? (
          <Link
            href="/admin/credit-notes/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={16} /> สร้าง CN ใหม่
          </Link>
        ) : null}
      </div>

      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <DateRangeFilter from={from} to={to} />
        <SearchBar placeholder="ค้นหาเลขที่ CN, ชื่อลูกค้า..." />
      </div>

      {q && (
        <p className="text-sm text-gray-500 mb-3">ผลการค้นหา &quot;{q}&quot;: {totalCount} รายการ</p>
      )}

      {(selectedCustomer || selectedProduct) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <span className="font-medium">Filter-ready drilldown:</span>
          {selectedCustomer ? (
            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-sky-900">
              ลูกค้า: {selectedCustomer.name} {selectedCustomer.code ? `(${selectedCustomer.code})` : ""}
            </span>
          ) : null}
          {selectedProduct ? (
            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-sky-900">
              สินค้า: {selectedProduct.name} {selectedProduct.code ? `(${selectedProduct.code})` : ""}
            </span>
          ) : null}
          <Link
            href="/admin/credit-notes"
            className="ml-auto text-xs font-medium text-sky-700 underline-offset-2 hover:underline"
          >
            ล้าง filter drilldown
          </Link>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-center py-3 px-4 font-medium text-gray-600 w-10">#</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">เลขที่ CN</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">วันที่</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ประเภท</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">การชำระ CN</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">อ้างอิงใบขาย</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">รายการ</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">ยอดรวม</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">สถานะ</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody>
              {creditNotes.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-gray-400">
                    {q ? `ไม่พบรายการที่ตรงกับ "${q}"` : "ยังไม่มีรายการ Credit Note"}
                  </td>
                </tr>
              ) : (
                creditNotes.map((cn, idx) => (
                  <tr key={cn.id}
                    className={`border-t border-gray-50 transition-colors ${
                      cn.status === "CANCELLED" ? "opacity-50 bg-red-50" : "hover:bg-gray-50"
                    }`}>
                    <td className="py-3 px-4 text-center text-gray-400 text-xs tabular-nums">{(pageNum - 1) * PAGE_SIZE + idx + 1}</td>
                    <td className="py-3 px-4 font-mono text-[#1e3a5f] font-medium">{cn.cnNo}</td>
                    <td className="py-3 px-4 text-gray-600">
                    {formatDateThai(cn.cnDate)}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        cn.type === CreditNoteType.RETURN ? "bg-blue-100 text-blue-700" : "bg-yellow-100 text-yellow-700"
                      }`}>
                        {cnTypeLabel[cn.type]}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${settlementTypeBadge[cn.settlementType]}`}>
                          {settlementTypeLabel[cn.settlementType]}
                        </span>
                        {cn.refundMethod && (
                          <span className="text-xs text-gray-400">
                            ({cn.refundMethod === CNRefundMethod.CASH ? "เงินสด" : "โอนเงิน"})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {cn.sale ? <span className="font-mono text-xs">{cn.sale.saleNo}</span> : "-"}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-600">{cn._count.items} รายการ</td>
                    <td className="py-3 px-4 text-right font-medium text-gray-900">
                      {Number(cn.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4">
                      {cn.status === "CANCELLED" ? (
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
                        <Link href={`/admin/credit-notes/${cn.id}`}
                          className="inline-flex items-center gap-1 text-xs text-[#1e3a5f] hover:text-blue-700 transition-colors">
                          <Eye size={14} /> ดู
                        </Link>
                        {cn.status === "ACTIVE" && (
                          <>
                            {canUpdate ? (
                              <Link href={`/admin/credit-notes/${cn.id}/edit`}
                                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors">
                                <Pencil size={14} /> แก้ไข
                              </Link>
                            ) : null}
                            {canCancel ? <CreditNoteCancelButton cnId={cn.id} docNo={cn.cnNo} /> : null}
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
        basePath="/admin/credit-notes"
        searchParams={paginationParams}
      />
    </div>
  );
};

export default CreditNotesPage;
