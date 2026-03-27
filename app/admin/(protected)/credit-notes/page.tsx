export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { Plus, Eye, Pencil } from "lucide-react";
import { CNRefundMethod, CNSettlementType, CreditNoteType } from "@/lib/generated/prisma";
import type { Prisma } from "@/lib/generated/prisma";
import SearchBar from "@/components/shared/SearchBar";
import CreditNoteCancelButton from "./CreditNoteCancelButton";
import Pagination from "@/components/shared/Pagination";

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
  searchParams: Promise<{ q?: string; page?: string }>;
}) => {
  const { q, page } = await searchParams;
  const pageNum = Math.max(1, parseInt(page ?? "1", 10));

  const where: Prisma.CreditNoteWhereInput = q ? {
    OR: [
      { cnNo:         { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
      { customer:     { name: { contains: q, mode: "insensitive" } } },
      { note:         { contains: q, mode: "insensitive" } },
    ],
  } : {};

  const whereClause = Object.keys(where).length > 0 ? where : undefined;

  const [creditNotes, totalCount] = await Promise.all([
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
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const paginationParams: Record<string, string> = {};
  if (q) paginationParams.q = q;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">ใบลดหนี้ (Credit Note)</h1>
        <Link
          href="/admin/credit-notes/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus size={16} /> สร้าง CN ใหม่
        </Link>
      </div>

      <div className="flex items-center justify-between mb-4 gap-4">
        <SearchBar placeholder="ค้นหาเลขที่ CN, ชื่อลูกค้า..." />
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
                      {new Date(cn.cnDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
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
                            <Link href={`/admin/credit-notes/${cn.id}/edit`}
                              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors">
                              <Pencil size={14} /> แก้ไข
                            </Link>
                            <CreditNoteCancelButton cnId={cn.id} docNo={cn.cnNo} />
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
