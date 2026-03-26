export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { Plus, Eye, Pencil } from "lucide-react";
import type { Prisma } from "@/lib/generated/prisma";
import SearchBar from "@/components/shared/SearchBar";
import PurchaseCancelButton from "./PurchaseCancelButton";
import Pagination from "@/components/shared/Pagination";

const PAGE_SIZE = 30;

const PurchasesPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) => {
  const { q, page } = await searchParams;
  const pageNum = Math.max(1, parseInt(page ?? "1", 10));

  const where: Prisma.PurchaseWhereInput = q ? {
    OR: [
      { purchaseNo:  { contains: q, mode: "insensitive" } },
      { referenceNo: { contains: q, mode: "insensitive" } },
      { supplier:    { name: { contains: q, mode: "insensitive" } } },
      { note:        { contains: q, mode: "insensitive" } },
    ],
  } : {};

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
  if (q) paginationParams.q = q;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">ใบซื้อสินค้า</h1>
        <Link href="/admin/purchases/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors">
          <Plus size={16} /> สร้างใบซื้อใหม่
        </Link>
      </div>

      <div className="flex items-center justify-between mb-4 gap-4">
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
                <th className="text-left py-3 px-4 font-medium text-gray-600">เลขที่ใบซื้อ</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">วันที่</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ซัพพลายเออร์</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">จำนวนรายการ</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">ยอดสุทธิ</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">สถานะ</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody>
              {purchases.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400">
                    {q ? `ไม่พบรายการที่ตรงกับ "${q}"` : "ยังไม่มีใบซื้อ"}
                  </td>
                </tr>
              ) : (
                purchases.map((p) => (
                  <tr key={p.id}
                    className={`border-t border-gray-50 transition-colors ${
                      p.status === "CANCELLED" ? "opacity-50 bg-red-50" : "hover:bg-gray-50"
                    }`}>
                    <td className="py-3 px-4 font-mono text-[#1e3a5f] font-medium">{p.purchaseNo}</td>
                    <td className="py-3 px-4 text-gray-600">
                      {new Date(p.purchaseDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
                    </td>
                    <td className="py-3 px-4 text-gray-600">{p.supplier?.name ?? "-"}</td>
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
                            <Link href={`/admin/purchases/${p.id}/edit`}
                              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors">
                              <Pencil size={14} /> แก้ไข
                            </Link>
                            <PurchaseCancelButton purchaseId={p.id} docNo={p.purchaseNo} />
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
