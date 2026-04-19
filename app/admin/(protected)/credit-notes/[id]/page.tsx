export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { ChevronLeft, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { CNRefundMethod, CNSettlementType, CreditNoteType } from "@/lib/generated/prisma";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { formatDateThai } from "@/lib/th-date";

const cnTypeLabel: Record<CreditNoteType, string> = {
  RETURN:   "รับคืนสินค้า",
  DISCOUNT: "ลดราคา",
  OTHER:    "อื่นๆ",
};

const settlementTypeLabel: Record<CNSettlementType, string> = {
  CASH_REFUND: "คืนเงินสด",
  CREDIT_DEBT: "ตั้งหนี้",
};

const refundMethodLabel: Record<CNRefundMethod, string> = {
  CASH:     "เงินสด",
  TRANSFER: "โอนเงิน",
};

const CreditNoteDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("credit_notes.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canUpdate = hasPermissionAccess(role, permissions, "credit_notes.update");
  const { id } = await params;

  const cn = await db.creditNote.findUnique({
    where: { id },
    include: {
      sale: { select: { saleNo: true } },
      user: { select: { name: true } },
      items: {
        include: {
          product: { select: { code: true, name: true } },
          lotItems: { select: { lotNo: true, qty: true, isReturnLot: true } },
        },
      },
    },
  });

  if (!cn) notFound();

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link href="/admin/credit-notes"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors">
          <ChevronLeft size={16} /> ใบลดหนี้ทั้งหมด
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">{cn.cnNo}</span>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-5 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <h1 className="font-kanit text-xl font-bold text-gray-900">ใบลดหนี้ (Credit Note)</h1>
            {cn.status === "CANCELLED" ? (
              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">ยกเลิกแล้ว</span>
            ) : (
              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">ใช้งาน</span>
            )}
          </div>
          {cn.status === "ACTIVE" && canUpdate && (
            <Link href={`/admin/credit-notes/${id}/edit`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 hover:border-[#1e3a5f] text-gray-600 hover:text-[#1e3a5f] rounded-lg transition-colors">
              <Pencil size={14} /> แก้ไข
            </Link>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 text-sm">
          <div>
            <p className="text-gray-500 mb-0.5">เลขที่ CN</p>
            <p className="font-mono font-semibold text-[#1e3a5f]">{cn.cnNo}</p>
          </div>
          <div>
            <p className="text-gray-500 mb-0.5">วันที่</p>
            <p className="font-medium text-gray-900">
                {formatDateThai(cn.cnDate)}
            </p>
          </div>
          <div>
            <p className="text-gray-500 mb-0.5">ประเภท CN</p>
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
              cn.type === CreditNoteType.RETURN ? "bg-blue-100 text-blue-700" : "bg-yellow-100 text-yellow-700"
            }`}>
              {cnTypeLabel[cn.type]}
            </span>
          </div>
          <div>
            <p className="text-gray-500 mb-0.5">การชำระ CN</p>
            <p className="font-medium text-gray-900">
              {settlementTypeLabel[cn.settlementType]}
              {cn.refundMethod && ` (${refundMethodLabel[cn.refundMethod]})`}
            </p>
          </div>
          {cn.sale && (
            <div>
              <p className="text-gray-500 mb-0.5">อ้างอิงใบขาย</p>
              <Link href={`/admin/sales/${cn.saleId}`}
                className="font-mono text-[#1e3a5f] hover:underline">
                {cn.sale.saleNo}
              </Link>
            </div>
          )}
          <div>
            <p className="text-gray-500 mb-0.5">ผู้บันทึก</p>
            <p className="font-medium text-gray-900">{cn.user?.name ?? "-"}</p>
          </div>
          {cn.note && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-gray-500 mb-0.5">หมายเหตุ</p>
              <p className="text-gray-700">{cn.note}</p>
            </div>
          )}
          {cn.status === "CANCELLED" && cn.cancelNote && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-gray-500 mb-0.5">เหตุผลยกเลิก</p>
              <p className="text-red-600">{cn.cancelNote}</p>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-4 pb-3 border-b border-gray-100">
          รายการ
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-2 px-3 font-medium text-gray-600">รหัส</th>
                <th className="text-left py-2 px-3 font-medium text-gray-600">สินค้า</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">จำนวน (base)</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">ราคา/หน่วย</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">รวม</th>
              </tr>
            </thead>
            <tbody>
              {cn.items.map((item) => (
                <tr key={item.id} className="border-t border-gray-50">
                  <td className="py-2 px-3 font-mono text-xs text-gray-500">{item.product?.code ?? "-"}</td>
                  <td className="py-2 px-3 text-gray-800">
                    <div>{item.product?.name ?? "-"}</div>
                    {item.lotItems.length > 0 && (
                      <div className="mt-1 text-xs text-amber-700">
                        Lot: {item.lotItems.map((lot) => `${lot.lotNo}${lot.isReturnLot ? " [RET]" : ""} (${Number(lot.qty)})`).join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right text-gray-700">{Number(item.qty)}</td>
                  <td className="py-2 px-3 text-right text-gray-700">
                    {Number(item.unitPrice).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-2 px-3 text-right font-medium text-gray-900">
                    {Number(item.amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 bg-gray-50">
              {cn.vatType !== "NO_VAT" && (
                <>
                  <tr>
                    <td colSpan={4} className="py-1 px-3 text-right text-sm text-gray-500">ยอดก่อนภาษี</td>
                    <td className="py-1 px-3 text-right text-gray-700">
                      {Number(cn.subtotalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="py-1 px-3 text-right text-sm text-gray-500">
                      VAT {Number(cn.vatRate)}%
                    </td>
                    <td className="py-1 px-3 text-right text-gray-700">
                      +{Number(cn.vatAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </>
              )}
              <tr>
                <td colSpan={4} className="py-3 px-3 text-right font-semibold text-gray-700">ยอดสุทธิ</td>
                <td className="py-3 px-3 text-right font-bold text-[#1e3a5f] text-base">
                  {Number(cn.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};

export default CreditNoteDetailPage;
