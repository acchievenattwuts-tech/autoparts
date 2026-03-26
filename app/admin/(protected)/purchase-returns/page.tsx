export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { Plus, Eye, Pencil } from "lucide-react";
import type { Prisma } from "@/lib/generated/prisma";
import SearchBar from "@/components/shared/SearchBar";
import PurchaseReturnCancelButton from "./PurchaseReturnCancelButton";

const PurchaseReturnsPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) => {
  const { q } = await searchParams;

  const where: Prisma.PurchaseReturnWhereInput = q ? {
    OR: [
      { returnNo:  { contains: q, mode: "insensitive" } },
      { supplier:  { name: { contains: q, mode: "insensitive" } } },
      { note:      { contains: q, mode: "insensitive" } },
    ],
  } : {};

  const returns = await db.purchaseReturn.findMany({
    where: Object.keys(where).length > 0 ? where : undefined,
    orderBy: { returnDate: "desc" },
    take:    100,
    include: {
      supplier: { select: { name: true } },
      _count:   { select: { items: true } },
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">คืนสินค้าให้ซัพพลายเออร์</h1>
        <Link
          href="/admin/purchase-returns/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus size={16} /> บันทึกคืนสินค้าใหม่
        </Link>
      </div>

      <div className="flex items-center justify-between mb-4 gap-4">
        <SearchBar placeholder="ค้นหาเลขที่ใบคืน, ซัพพลายเออร์..." />
      </div>

      {q && (
        <p className="text-sm text-gray-500 mb-3">ผลการค้นหา &quot;{q}&quot;: {returns.length} รายการ</p>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-3 px-4 font-medium text-gray-600">เลขที่</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">วันที่</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ซัพพลายเออร์</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">รายการ</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">ยอดรวม</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">สถานะ</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody>
              {returns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400">
                    {q ? `ไม่พบรายการที่ตรงกับ "${q}"` : "ยังไม่มีรายการคืนสินค้า"}
                  </td>
                </tr>
              ) : (
                returns.map((r) => (
                  <tr key={r.id}
                    className={`border-t border-gray-50 transition-colors ${
                      r.status === "CANCELLED" ? "opacity-50 bg-red-50" : "hover:bg-gray-50"
                    }`}>
                    <td className="py-3 px-4 font-mono text-[#1e3a5f] font-medium">{r.returnNo}</td>
                    <td className="py-3 px-4 text-gray-600">
                      {new Date(r.returnDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
                    </td>
                    <td className="py-3 px-4 text-gray-600">{r.supplier?.name ?? "-"}</td>
                    <td className="py-3 px-4 text-right text-gray-600">{r._count.items} รายการ</td>
                    <td className="py-3 px-4 text-right font-medium text-gray-900">
                      {Number(r.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4">
                      {r.status === "CANCELLED" ? (
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
                        <Link href={`/admin/purchase-returns/${r.id}`}
                          className="inline-flex items-center gap-1 text-xs text-[#1e3a5f] hover:text-blue-700 transition-colors">
                          <Eye size={14} /> ดู
                        </Link>
                        {r.status === "ACTIVE" && (
                          <>
                            <Link href={`/admin/purchase-returns/${r.id}/edit`}
                              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors">
                              <Pencil size={14} /> แก้ไข
                            </Link>
                            <PurchaseReturnCancelButton returnId={r.id} />
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
    </div>
  );
};

export default PurchaseReturnsPage;
