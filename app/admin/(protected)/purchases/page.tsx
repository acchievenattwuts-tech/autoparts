import { db } from "@/lib/db";
import Link from "next/link";
import { Plus } from "lucide-react";

const PurchasesPage = async () => {
  const purchases = await db.purchase.findMany({
    orderBy: { purchaseDate: "desc" },
    take: 50,
    include: {
      supplier: { select: { name: true } },
      items: { select: { id: true } },
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">ใบซื้อสินค้า</h1>
        <Link href="/admin/purchases/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors">
          <Plus size={16} /> สร้างใบซื้อใหม่
        </Link>
      </div>

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
              </tr>
            </thead>
            <tbody>
              {purchases.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-gray-400">ยังไม่มีใบซื้อ</td>
                </tr>
              ) : (
                purchases.map((p) => (
                  <tr key={p.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 font-mono text-[#1e3a5f] font-medium">{p.purchaseNo}</td>
                    <td className="py-3 px-4 text-gray-600">
                      {new Date(p.purchaseDate).toLocaleDateString("th-TH")}
                    </td>
                    <td className="py-3 px-4 text-gray-600">{p.supplier?.name ?? "-"}</td>
                    <td className="py-3 px-4 text-right text-gray-600">{p.items.length} รายการ</td>
                    <td className="py-3 px-4 text-right font-medium text-gray-900">
                      {Number(p.netAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
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

export default PurchasesPage;
