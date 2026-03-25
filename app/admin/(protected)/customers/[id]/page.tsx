export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { ChevronLeft, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { SaleType, PaymentMethod } from "@/lib/generated/prisma";

const saleTypeLabel: Record<SaleType, string> = {
  RETAIL:    "ปลีก",
  WHOLESALE: "ส่ง",
};

const saleTypeBadge: Record<SaleType, string> = {
  RETAIL:    "bg-green-100 text-green-700",
  WHOLESALE: "bg-blue-100 text-blue-700",
};

const paymentMethodLabel: Record<PaymentMethod, string> = {
  CASH:     "เงินสด",
  TRANSFER: "โอนเงิน",
  CREDIT:   "เครดิต",
};

const CustomerDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;

  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      sales: {
        orderBy: { saleDate: "desc" },
        take: 50,
        select: {
          id:            true,
          saleNo:        true,
          saleDate:      true,
          netAmount:     true,
          saleType:      true,
          paymentMethod: true,
          _count: { select: { items: true } },
        },
      },
    },
  });
  if (!customer) notFound();

  const totalSpent = customer.sales.reduce((sum, s) => sum + Number(s.netAmount), 0);

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/admin/customers"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors"
        >
          <ChevronLeft size={16} /> รายการลูกค้า
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">{customer.name}</span>
      </div>

      {/* Info card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-start justify-between mb-5 pb-3 border-b border-gray-100">
          <h1 className="font-kanit text-xl font-bold text-gray-900">{customer.name}</h1>
          <Link
            href={`/admin/customers/${id}/edit`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1e3a5f] hover:bg-[#162d4a] text-white text-xs font-medium rounded-lg transition-colors"
          >
            <Pencil size={12} /> แก้ไข
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-gray-500 mb-1">รหัสลูกค้า</p>
            <p className="font-medium text-gray-900 font-mono">{customer.code ?? "-"}</p>
          </div>
          <div>
            <p className="text-gray-500 mb-1">เบอร์โทร</p>
            <p className="font-medium text-gray-900">{customer.phone ?? "-"}</p>
          </div>
          <div>
            <p className="text-gray-500 mb-1">เลขผู้เสียภาษี</p>
            <p className="font-medium text-gray-900">{customer.taxId ?? "-"}</p>
          </div>
          {customer.address && (
            <div className="sm:col-span-2 md:col-span-3">
              <p className="text-gray-500 mb-1">ที่อยู่</p>
              <p className="font-medium text-gray-900">{customer.address}</p>
            </div>
          )}
          {customer.shippingAddress && (
            <div className="sm:col-span-2 md:col-span-3">
              <p className="text-gray-500 mb-1">ที่อยู่จัดส่ง</p>
              <p className="font-medium text-gray-900">{customer.shippingAddress}</p>
            </div>
          )}
          {customer.note && (
            <div className="sm:col-span-2 md:col-span-3">
              <p className="text-gray-500 mb-1">หมายเหตุ</p>
              <p className="font-medium text-gray-900">{customer.note}</p>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <p className="text-sm text-gray-500 mb-1">ยอดซื้อทั้งหมด</p>
          <p className="font-kanit text-2xl font-bold text-[#1e3a5f]">
            {totalSpent.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-gray-400 mt-1">บาท</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <p className="text-sm text-gray-500 mb-1">จำนวนครั้งที่ซื้อ</p>
          <p className="font-kanit text-2xl font-bold text-[#1e3a5f]">
            {customer.sales.length}
          </p>
          <p className="text-xs text-gray-400 mt-1">ครั้ง</p>
        </div>
      </div>

      {/* Purchase history */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f]">ประวัติการซื้อ</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-3 px-4 font-medium text-gray-600">เลขที่</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">วันที่</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ประเภท</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">ยอดสุทธิ</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ช่องทางชำระ</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">รายการ</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody>
              {customer.sales.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-gray-400">
                    ยังไม่มีประวัติการซื้อ
                  </td>
                </tr>
              ) : (
                customer.sales.map((s) => (
                  <tr key={s.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 font-mono text-[#1e3a5f] font-medium">{s.saleNo}</td>
                    <td className="py-3 px-4 text-gray-600">
                      {new Date(s.saleDate).toLocaleDateString("th-TH")}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${saleTypeBadge[s.saleType]}`}>
                        {saleTypeLabel[s.saleType]}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-gray-900">
                      {Number(s.netAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {paymentMethodLabel[s.paymentMethod] ?? s.paymentMethod}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-600">{s._count.items} รายการ</td>
                    <td className="py-3 px-4">
                      <Link
                        href={`/admin/sales/${s.id}`}
                        className="text-xs text-[#1e3a5f] hover:text-blue-700 transition-colors"
                      >
                        ดูใบเสร็จ
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

export default CustomerDetailPage;
