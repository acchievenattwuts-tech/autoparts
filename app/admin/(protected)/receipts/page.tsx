export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { Plus, Eye, Pencil } from "lucide-react";
import { PaymentMethod } from "@/lib/generated/prisma";
import type { Prisma } from "@/lib/generated/prisma";
import SearchBar from "@/components/shared/SearchBar";
import ReceiptCancelButton from "./ReceiptCancelButton";

const paymentMethodLabel: Record<PaymentMethod, string> = {
  CASH:     "เงินสด",
  TRANSFER: "โอนเงิน",
  CREDIT:   "เครดิต",
};

const ReceiptsPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) => {
  const { q } = await searchParams;

  const where: Prisma.ReceiptWhereInput = q ? {
    OR: [
      { receiptNo:    { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
      { customer:     { name: { contains: q, mode: "insensitive" } } },
      { note:         { contains: q, mode: "insensitive" } },
    ],
  } : {};

  const receipts = await db.receipt.findMany({
    where: Object.keys(where).length > 0 ? where : undefined,
    orderBy: { receiptDate: "desc" },
    take: 100,
    include: {
      customer: { select: { name: true } },
      _count:   { select: { items: true } },
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">ใบเสร็จรับเงิน</h1>
        <Link
          href="/admin/receipts/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#1e3a5f] hover:bg-[#162d4a] text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus size={16} /> สร้างใบเสร็จใหม่
        </Link>
      </div>

      <div className="flex items-center justify-between mb-4 gap-4">
        <SearchBar placeholder="ค้นหาเลขที่ใบเสร็จ, ชื่อลูกค้า..." />
      </div>

      {q && (
        <p className="text-sm text-gray-500 mb-3">ผลการค้นหา &quot;{q}&quot;: {receipts.length} รายการ</p>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-3 px-4 font-medium text-gray-600">เลขที่ใบเสร็จ</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">วันที่</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ลูกค้า</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">รายการ (ใบขาย)</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">ยอดรับชำระ</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ช่องทาง</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">สถานะ</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody>
              {receipts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-gray-400">
                    {q ? `ไม่พบรายการที่ตรงกับ "${q}"` : "ยังไม่มีใบเสร็จรับเงิน"}
                  </td>
                </tr>
              ) : (
                receipts.map((r) => (
                  <tr key={r.id}
                    className={`border-t border-gray-50 transition-colors ${
                      r.status === "CANCELLED" ? "opacity-50 bg-red-50" : "hover:bg-gray-50"
                    }`}>
                    <td className="py-3 px-4 font-mono text-[#1e3a5f] font-medium">{r.receiptNo}</td>
                    <td className="py-3 px-4 text-gray-600">
                      {new Date(r.receiptDate).toLocaleDateString("th-TH")}
                    </td>
                    <td className="py-3 px-4 text-gray-700">
                      {r.customer?.name ?? r.customerName ?? "-"}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-600">{r._count.items} ใบ</td>
                    <td className="py-3 px-4 text-right font-medium text-gray-900">
                      {Number(r.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                        {paymentMethodLabel[r.paymentMethod]}
                      </span>
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
                        <Link href={`/admin/receipts/${r.id}`}
                          className="inline-flex items-center gap-1 text-xs text-[#1e3a5f] hover:text-blue-700 transition-colors">
                          <Eye size={14} /> ดู
                        </Link>
                        {r.status === "ACTIVE" && (
                          <>
                            <Link href={`/admin/receipts/${r.id}/edit`}
                              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors">
                              <Pencil size={14} /> แก้ไข
                            </Link>
                            <ReceiptCancelButton receiptId={r.id} />
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

export default ReceiptsPage;
