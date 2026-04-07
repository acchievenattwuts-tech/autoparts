export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { ChevronLeft, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";

const PurchaseReturnDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("purchase_returns.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canUpdate = hasPermissionAccess(role, permissions, "purchase_returns.update");
  const { id } = await params;

  const ret = await db.purchaseReturn.findUnique({
    where: { id },
    include: {
      supplier: { select: { name: true } },
      purchase: { select: { purchaseNo: true } },
      cashBankAccount: { select: { name: true } },
      user:     { select: { name: true } },
      items: {
        include: {
          product: { select: { code: true, name: true } },
          lotItems: { select: { lotNo: true, qty: true } },
        },
      },
    },
  });

  if (!ret) notFound();

  const vatLabel: Record<string, string> = {
    NO_VAT:        "ไม่มี VAT",
    EXCLUDING_VAT: "แยก VAT",
    INCLUDING_VAT:  "รวม VAT แล้ว",
  };

  const returnTypeLabel: Record<string, string> = {
    RETURN:   "ส่งคืนสินค้า",
    DISCOUNT: "ส่วนลดราคา",
    OTHER:    "อื่นๆ",
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link href="/admin/purchase-returns"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors">
          <ChevronLeft size={16} /> คืนสินค้าทั้งหมด
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">{ret.returnNo}</span>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-5 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <h1 className="font-kanit text-xl font-bold text-gray-900">คืนสินค้าให้ซัพพลายเออร์</h1>
            {ret.status === "CANCELLED" ? (
              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">ยกเลิกแล้ว</span>
            ) : (
              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">ใช้งาน</span>
            )}
          </div>
          {ret.status === "ACTIVE" && canUpdate && (
            <Link href={`/admin/purchase-returns/${id}/edit`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 hover:border-[#1e3a5f] text-gray-600 hover:text-[#1e3a5f] rounded-lg transition-colors">
              <Pencil size={14} /> แก้ไข
            </Link>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 text-sm">
          <div>
            <p className="text-gray-500 mb-0.5">เลขที่คืนสินค้า</p>
            <p className="font-mono font-semibold text-[#1e3a5f]">{ret.returnNo}</p>
          </div>
          <div>
            <p className="text-gray-500 mb-0.5">วันที่คืน</p>
            <p className="font-medium text-gray-900">
              {new Date(ret.returnDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
            </p>
          </div>
          <div>
            <p className="text-gray-500 mb-0.5">ซัพพลายเออร์</p>
            <p className="font-medium text-gray-900">{ret.supplier?.name ?? "-"}</p>
          </div>
          {ret.purchase && (
            <div>
              <p className="text-gray-500 mb-0.5">อ้างอิงใบซื้อ</p>
              <Link href={`/admin/purchases/${ret.purchaseId}`}
                className="font-mono text-[#1e3a5f] hover:underline">
                {ret.purchase.purchaseNo}
              </Link>
            </div>
          )}
          <div>
            <p className="text-gray-500 mb-0.5">ประเภทการคืน</p>
            <p className="font-medium text-gray-900">{returnTypeLabel[ret.type] ?? ret.type}</p>
          </div>
          <div>
            <p className="text-gray-500 mb-0.5">ภาษี</p>
            <p className="font-medium text-gray-900">{vatLabel[ret.vatType] ?? ret.vatType}</p>
          </div>
          <div>
            <p className="text-gray-500 mb-0.5">ผู้บันทึก</p>
            <p className="font-medium text-gray-900">{ret.user?.name ?? "-"}</p>
          </div>
          {ret.note && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-gray-500 mb-0.5">หมายเหตุ</p>
              <p className="text-gray-700">{ret.note}</p>
            </div>
          )}
          {ret.status === "CANCELLED" && ret.cancelNote && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-gray-500 mb-0.5">เหตุผลยกเลิก</p>
              <p className="text-red-600">{ret.cancelNote}</p>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-4 pb-3 border-b border-gray-100">
          รายการสินค้าที่คืน
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-2 px-3 font-medium text-gray-600">รหัส</th>
                <th className="text-left py-2 px-3 font-medium text-gray-600">สินค้า</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">จำนวน (base)</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">ทุน/หน่วย</th>
                <th className="text-right py-2 px-3 font-medium text-gray-600">รวม</th>
              </tr>
            </thead>
            <tbody>
              {ret.items.map((item) => (
                <tr key={item.id} className="border-t border-gray-50">
                  <td className="py-2 px-3 font-mono text-xs text-gray-500">{item.product.code}</td>
                  <td className="py-2 px-3 text-gray-800">
                    <div>{item.product.name}</div>
                    {item.lotItems.length > 0 && (
                      <div className="mt-1 text-xs text-amber-700">
                        Lot: {item.lotItems.map((lot) => `${lot.lotNo} (${Number(lot.qty)})`).join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right text-gray-700">{Number(item.qty)}</td>
                  <td className="py-2 px-3 text-right text-gray-700">
                    {Number(item.costPrice).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-2 px-3 text-right font-medium text-gray-900">
                    {Number(item.amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 bg-gray-50">
              {ret.vatType !== "NO_VAT" && (
                <>
                  <tr>
                    <td colSpan={4} className="py-1 px-3 text-right text-sm text-gray-500">ยอดก่อนภาษี</td>
                    <td className="py-1 px-3 text-right text-gray-700">
                      {Number(ret.subtotalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="py-1 px-3 text-right text-sm text-gray-500">
                      VAT {Number(ret.vatRate)}%
                    </td>
                    <td className="py-1 px-3 text-right text-gray-700">
                      +{Number(ret.vatAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </>
              )}
              <tr>
                <td colSpan={4} className="py-3 px-3 text-right font-semibold text-gray-700">ยอดสุทธิ</td>
                <td className="py-3 px-3 text-right font-bold text-[#1e3a5f] text-base">
                  {Number(ret.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PurchaseReturnDetailPage;
