export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { Plus, Eye } from "lucide-react";
import { FulfillmentType, SaleType } from "@/lib/generated/prisma";

const paymentMethodLabel: Record<string, string> = {
  CASH:     "เงินสด",
  TRANSFER: "โอนเงิน",
  CREDIT:   "เครดิต",
};

const saleTypeLabel: Record<SaleType, string> = {
  RETAIL:    "ปลีก",
  WHOLESALE: "ส่ง",
};

const saleTypeBadge: Record<SaleType, string> = {
  RETAIL:    "bg-green-100 text-green-700",
  WHOLESALE: "bg-blue-100 text-blue-700",
};

const fulfillmentLabel: Record<FulfillmentType, string> = {
  PICKUP:   "หน้าร้าน",
  DELIVERY: "จัดส่ง",
};

const fulfillmentBadge: Record<FulfillmentType, string> = {
  PICKUP:   "bg-gray-100 text-gray-600",
  DELIVERY: "bg-purple-100 text-purple-700",
};

const SalesPage = async () => {
  const sales = await db.sale.findMany({
    orderBy: { saleDate: "desc" },
    take: 100,
    include: {
      _count: { select: { items: true } },
      customer: { select: { name: true } },
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">บันทึกการขาย</h1>
        <Link
          href="/admin/sales/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus size={16} /> บันทึกการขายใหม่
        </Link>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-3 px-4 font-medium text-gray-600">เลขที่ใบขาย</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">วันที่</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ลูกค้า</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ประเภท</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">การจัดส่ง</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">รายการ</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">ยอดสุทธิ</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ช่องทางชำระ</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody>
              {sales.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-gray-400">
                    ยังไม่มีรายการขาย
                  </td>
                </tr>
              ) : (
                sales.map((s) => (
                  <tr key={s.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 font-mono text-[#1e3a5f] font-medium">{s.saleNo}</td>
                    <td className="py-3 px-4 text-gray-600">
                      {new Date(s.saleDate).toLocaleDateString("th-TH")}
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {s.customer?.name ?? s.customerName ?? "-"}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${saleTypeBadge[s.saleType]}`}>
                        {saleTypeLabel[s.saleType]}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${fulfillmentBadge[s.fulfillmentType]}`}>
                        {fulfillmentLabel[s.fulfillmentType]}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-gray-600">{s._count.items} รายการ</td>
                    <td className="py-3 px-4 text-right font-medium text-gray-900">
                      {Number(s.netAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {paymentMethodLabel[s.paymentMethod] ?? s.paymentMethod}
                    </td>
                    <td className="py-3 px-4">
                      <Link
                        href={`/admin/sales/${s.id}`}
                        className="inline-flex items-center gap-1 text-xs text-[#1e3a5f] hover:text-blue-700 transition-colors"
                      >
                        <Eye size={14} /> ดูรายละเอียด
                      </Link>
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

export default SalesPage;
