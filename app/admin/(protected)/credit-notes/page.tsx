export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { Plus } from "lucide-react";
import { CreditNoteType } from "@/lib/generated/prisma";

const cnTypeLabel: Record<CreditNoteType, string> = {
  RETURN:   "รับคืนสินค้า",
  DISCOUNT: "ลดราคา",
};

const CreditNotesPage = async () => {
  const creditNotes = await db.creditNote.findMany({
    orderBy: { cnDate: "desc" },
    take:    100,
    include: {
      sale: { select: { saleNo: true } },
      _count: { select: { items: true } },
    },
  });

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

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-3 px-4 font-medium text-gray-600">เลขที่ CN</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">วันที่</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ประเภท</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">อ้างอิงใบขาย</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">รายการ</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">ยอดรวม</th>
              </tr>
            </thead>
            <tbody>
              {creditNotes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400">
                    ยังไม่มีรายการ Credit Note
                  </td>
                </tr>
              ) : (
                creditNotes.map((cn) => (
                  <tr key={cn.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 font-mono text-[#1e3a5f] font-medium">{cn.cnNo}</td>
                    <td className="py-3 px-4 text-gray-600">
                      {new Date(cn.cnDate).toLocaleDateString("th-TH")}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          cn.type === CreditNoteType.RETURN
                            ? "bg-blue-100 text-blue-700"
                            : "bg-yellow-100 text-yellow-700"
                        }`}
                      >
                        {cnTypeLabel[cn.type]}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {cn.sale ? (
                        <span className="font-mono text-xs">{cn.sale.saleNo}</span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-600">
                      {cn._count.items} รายการ
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-gray-900">
                      {Number(cn.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
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

export default CreditNotesPage;
