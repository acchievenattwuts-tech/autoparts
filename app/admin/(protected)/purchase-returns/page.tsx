export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { Plus } from "lucide-react";

const PurchaseReturnsPage = async () => {
  const returns = await db.purchaseReturn.findMany({
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
              </tr>
            </thead>
            <tbody>
              {returns.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-gray-400">
                    ยังไม่มีรายการคืนสินค้า
                  </td>
                </tr>
              ) : (
                returns.map((r) => (
                  <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 font-mono text-[#1e3a5f] font-medium">{r.returnNo}</td>
                    <td className="py-3 px-4 text-gray-600">
                      {new Date(r.returnDate).toLocaleDateString("th-TH")}
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {r.supplier?.name ?? "-"}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-600">
                      {r._count.items} รายการ
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-gray-900">
                      {Number(r.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
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
