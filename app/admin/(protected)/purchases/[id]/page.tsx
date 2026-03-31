export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { ChevronLeft, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";

const PurchaseDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("purchases.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canUpdate = hasPermissionAccess(role, permissions, "purchases.update");
  const { id } = await params;

  const purchase = await db.purchase.findUnique({
    where: { id },
    include: {
      supplier: { select: { name: true } },
      user:     { select: { name: true } },
      items: {
        include: {
          product:  { select: { code: true, name: true, isLotControl: true } },
          lotItems: { select: { lotNo: true, qty: true, unitCost: true, mfgDate: true, expDate: true } },
        },
      },
    },
  });

  if (!purchase) notFound();

  const vatLabel: Record<string, string> = {
    NO_VAT:        "ไม่มี VAT",
    EXCLUDING_VAT: "แยก VAT",
    INCLUDING_VAT:  "รวม VAT แล้ว",
  };

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6">
        <Link href="/admin/purchases"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors">
          <ChevronLeft size={16} /> ใบซื้อทั้งหมด
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">{purchase.purchaseNo}</span>
      </div>

      {/* Header card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-5 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <h1 className="font-kanit text-xl font-bold text-gray-900">ใบซื้อสินค้า</h1>
            {purchase.status === "CANCELLED" ? (
              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">ยกเลิกแล้ว</span>
            ) : (
              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">ใช้งาน</span>
            )}
          </div>
          {purchase.status === "ACTIVE" && canUpdate && (
            <Link href={`/admin/purchases/${id}/edit`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 hover:border-[#1e3a5f] text-gray-600 hover:text-[#1e3a5f] rounded-lg transition-colors">
              <Pencil size={14} /> แก้ไข
            </Link>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4 text-sm">
          <div>
            <p className="text-gray-500 mb-0.5">เลขที่ใบซื้อ</p>
            <p className="font-mono font-semibold text-[#1e3a5f]">{purchase.purchaseNo}</p>
          </div>
          <div>
            <p className="text-gray-500 mb-0.5">วันที่ซื้อ</p>
            <p className="font-medium text-gray-900">
              {new Date(purchase.purchaseDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
            </p>
          </div>
          <div>
            <p className="text-gray-500 mb-0.5">ซัพพลายเออร์</p>
            <p className="font-medium text-gray-900">{purchase.supplier?.name ?? "-"}</p>
          </div>
          {purchase.referenceNo && (
            <div>
              <p className="text-gray-500 mb-0.5">เอกสารอ้างอิง</p>
              <p className="font-mono text-gray-800">{purchase.referenceNo}</p>
            </div>
          )}
          <div>
            <p className="text-gray-500 mb-0.5">ภาษี</p>
            <p className="font-medium text-gray-900">{vatLabel[purchase.vatType] ?? purchase.vatType}</p>
          </div>
          <div>
            <p className="text-gray-500 mb-0.5">ผู้บันทึก</p>
            <p className="font-medium text-gray-900">{purchase.user?.name ?? "-"}</p>
          </div>
          {purchase.note && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-gray-500 mb-0.5">หมายเหตุ</p>
              <p className="text-gray-700">{purchase.note}</p>
            </div>
          )}
          {purchase.status === "CANCELLED" && purchase.cancelNote && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-gray-500 mb-0.5">เหตุผลยกเลิก</p>
              <p className="text-red-600">{purchase.cancelNote}</p>
            </div>
          )}
        </div>
      </div>

      {/* Items table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-4 pb-3 border-b border-gray-100">
          รายการสินค้า
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
              {purchase.items.map((item) => (
                <>
                  <tr key={item.id} className="border-t border-gray-50">
                    <td className="py-2 px-3 font-mono text-xs text-gray-500">{item.product.code}</td>
                    <td className="py-2 px-3 text-gray-800">
                      {item.product.name}
                      {item.product.isLotControl && (
                        <span className="ml-2 inline-flex px-1.5 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">Lot</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-700">{item.quantity}</td>
                    <td className="py-2 px-3 text-right text-gray-700">
                      {Number(item.costPrice).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2 px-3 text-right font-medium text-gray-900">
                      {Number(item.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                  {item.lotItems.length > 0 && (
                    <tr key={`lot-${item.id}`} className="bg-amber-50/50">
                      <td colSpan={5} className="px-6 py-2">
                        <div className="flex flex-wrap gap-2">
                          {item.lotItems.map((lot) => (
                            <div key={lot.lotNo} className="inline-flex items-center gap-1.5 text-xs bg-white border border-amber-200 rounded-md px-2 py-1">
                              <span className="font-mono font-semibold text-amber-800">{lot.lotNo}</span>
                              <span className="text-gray-500">จำนวน</span>
                              <span className="font-medium text-gray-700">{Number(lot.qty)}</span>
                              {lot.expDate && (
                                <>
                                  <span className="text-gray-400">|</span>
                                  <span className="text-gray-500">EXP</span>
                                  <span className="text-gray-700">
                                    {new Date(lot.expDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
                                  </span>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 bg-gray-50">
              {Number(purchase.discount) > 0 && (
                <tr>
                  <td colSpan={4} className="py-2 px-3 text-right text-sm text-gray-500">ส่วนลด</td>
                  <td className="py-2 px-3 text-right text-red-500">
                    -{Number(purchase.discount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              )}
              {purchase.vatType !== "NO_VAT" && (
                <>
                  <tr>
                    <td colSpan={4} className="py-1 px-3 text-right text-sm text-gray-500">ยอดก่อนภาษี</td>
                    <td className="py-1 px-3 text-right text-gray-700">
                      {Number(purchase.subtotalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="py-1 px-3 text-right text-sm text-gray-500">
                      VAT {Number(purchase.vatRate)}%
                    </td>
                    <td className="py-1 px-3 text-right text-gray-700">
                      +{Number(purchase.vatAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </>
              )}
              <tr>
                <td colSpan={4} className="py-3 px-3 text-right font-semibold text-gray-700">ยอดสุทธิ</td>
                <td className="py-3 px-3 text-right font-bold text-[#1e3a5f] text-base">
                  {Number(purchase.netAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PurchaseDetailPage;
