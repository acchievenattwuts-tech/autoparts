export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { Plus, Eye, Pencil } from "lucide-react";
import { FulfillmentType, SalePaymentType, SaleType } from "@/lib/generated/prisma";
import type { Prisma } from "@/lib/generated/prisma";
import SalesFilterBar from "./SalesFilterBar";
import SearchBar from "@/components/shared/SearchBar";
import SaleCancelButton from "./SaleCancelButton";

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

const paymentTypeLabel: Record<SalePaymentType, string> = {
  CASH_SALE:   "สด",
  CREDIT_SALE: "เชื่อ",
};
const paymentTypeBadge: Record<SalePaymentType, string> = {
  CASH_SALE:   "bg-emerald-100 text-emerald-700",
  CREDIT_SALE: "bg-orange-100 text-orange-700",
};

const SalesPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ paymentType?: string; q?: string }>;
}) => {
  const params = await searchParams;
  const paymentTypeFilter = params.paymentType;
  const q = params.q;

  const where: Prisma.SaleWhereInput = {};
  if (paymentTypeFilter && paymentTypeFilter !== "ALL") {
    where.paymentType = paymentTypeFilter as SalePaymentType;
  }
  if (q) {
    where.OR = [
      { saleNo:       { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
      { customer:     { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const sales = await db.sale.findMany({
    where: Object.keys(where).length > 0 ? where : undefined,
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

      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <SalesFilterBar />
        <SearchBar placeholder="ค้นหาเลขที่ใบขาย, ชื่อลูกค้า..." />
      </div>

      {q && (
        <p className="text-sm text-gray-500 mb-3">ผลการค้นหา &quot;{q}&quot;: {sales.length} รายการ</p>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-3 px-4 font-medium text-gray-600">เลขที่ใบขาย</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">วันที่</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ลูกค้า</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ประเภท</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ขายสด/เชื่อ</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">การจัดส่ง</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">รายการ</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">ยอดสุทธิ</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ช่องทางชำระ</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">สถานะ</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody>
              {sales.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-12 text-gray-400">
                    {q ? `ไม่พบรายการที่ตรงกับ "${q}"` : "ยังไม่มีรายการขาย"}
                  </td>
                </tr>
              ) : (
                sales.map((s) => (
                  <tr key={s.id}
                    className={`border-t border-gray-50 transition-colors ${
                      s.status === "CANCELLED" ? "opacity-50 bg-red-50" : "hover:bg-gray-50"
                    }`}>
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
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${paymentTypeBadge[s.paymentType]}`}>
                        {paymentTypeLabel[s.paymentType]}
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
                      {s.paymentMethod ? (paymentMethodLabel[s.paymentMethod] ?? s.paymentMethod) : "-"}
                    </td>
                    <td className="py-3 px-4">
                      {s.status === "CANCELLED" ? (
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
                        <Link href={`/admin/sales/${s.id}`}
                          className="inline-flex items-center gap-1 text-xs text-[#1e3a5f] hover:text-blue-700 transition-colors">
                          <Eye size={14} /> ดู
                        </Link>
                        {s.status === "ACTIVE" && (
                          <>
                            <Link href={`/admin/sales/${s.id}/edit`}
                              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors">
                              <Pencil size={14} /> แก้ไข
                            </Link>
                            <SaleCancelButton saleId={s.id} />
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

export default SalesPage;
