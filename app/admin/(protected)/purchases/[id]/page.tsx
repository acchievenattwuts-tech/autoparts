export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { ChevronLeft, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { hasPermissionAccess } from "@/lib/access-control";
import { PaymentMethod, PurchasePaymentStatus } from "@/lib/generated/prisma";
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
      user: { select: { name: true } },
      items: {
        include: {
          product: { select: { code: true, name: true, isLotControl: true } },
          lotItems: { select: { lotNo: true, qty: true, unitCost: true, mfgDate: true, expDate: true } },
        },
      },
    },
  });

  if (!purchase) notFound();

  const vatLabel: Record<string, string> = {
    NO_VAT: "ไม่มี VAT",
    EXCLUDING_VAT: "แยก VAT",
    INCLUDING_VAT: "รวม VAT แล้ว",
  };

  const paymentMethodLabel: Record<PaymentMethod, string> = {
    CASH: "เงินสด",
    TRANSFER: "โอนเงิน",
    CREDIT: "เครดิต",
  };

  const paymentStatusLabel: Record<PurchasePaymentStatus, string> = {
    UNPAID: "ยังไม่ชำระ",
    PAID: purchase.cashBankAccountId ? "ชำระแล้ว (ตัดบัญชีทันที)" : "ชำระแล้ว (บันทึกเงินแยก)",
    PARTIALLY_PAID: "ชำระบางส่วน",
  };

  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <Link
          href="/admin/purchases"
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f]"
        >
          <ChevronLeft size={16} /> รายการซื้อทั้งหมด
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">{purchase.purchaseNo}</span>
      </div>

      <div className="mb-6 rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-3">
            <h1 className="font-kanit text-xl font-bold text-gray-900">รายละเอียดใบซื้อ</h1>
            {purchase.status === "CANCELLED" ? (
              <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                ยกเลิกแล้ว
              </span>
            ) : (
              <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                ใช้งาน
              </span>
            )}
          </div>
          {purchase.status === "ACTIVE" && canUpdate && (
            <Link
              href={`/admin/purchases/${id}/edit`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f]"
            >
              <Pencil size={14} /> แก้ไข
            </Link>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm md:grid-cols-3">
          <div>
            <p className="mb-0.5 text-gray-500">เลขที่ใบซื้อ</p>
            <p className="font-mono font-semibold text-[#1e3a5f]">{purchase.purchaseNo}</p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500">วันที่ซื้อ</p>
            <p className="font-medium text-gray-900">
              {new Date(purchase.purchaseDate).toLocaleDateString("th-TH-u-ca-gregory", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              })}
            </p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500">ผู้จำหน่าย</p>
            <p className="font-medium text-gray-900">{purchase.supplier?.name ?? "-"}</p>
          </div>
          {purchase.referenceNo && (
            <div>
              <p className="mb-0.5 text-gray-500">เอกสารอ้างอิง</p>
              <p className="font-mono text-gray-800">{purchase.referenceNo}</p>
            </div>
          )}
          <div>
            <p className="mb-0.5 text-gray-500">ภาษี</p>
            <p className="font-medium text-gray-900">{vatLabel[purchase.vatType] ?? purchase.vatType}</p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500">สถานะการชำระเงิน</p>
            <p className="font-medium text-gray-900">{paymentStatusLabel[purchase.paymentStatus] ?? purchase.paymentStatus}</p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500">ช่องทางชำระเงิน</p>
            <p className="font-medium text-gray-900">
              {purchase.cashBankAccountId ? (paymentMethodLabel[purchase.paymentMethod] ?? purchase.paymentMethod) : "-"}
            </p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500">ผู้บันทึก</p>
            <p className="font-medium text-gray-900">{purchase.user?.name ?? "-"}</p>
          </div>
          {purchase.note && (
            <div className="col-span-2 md:col-span-3">
              <p className="mb-0.5 text-gray-500">หมายเหตุ</p>
              <p className="text-gray-700">{purchase.note}</p>
            </div>
          )}
          {purchase.status === "CANCELLED" && purchase.cancelNote && (
            <div className="col-span-2 md:col-span-3">
              <p className="mb-0.5 text-gray-500">เหตุผลที่ยกเลิก</p>
              <p className="text-red-600">{purchase.cancelNote}</p>
            </div>
          )}
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <h2 className="mb-4 border-b border-gray-100 pb-3 font-kanit text-lg font-semibold text-[#1e3a5f]">
          รายการสินค้า
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600">รหัส</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">สินค้า</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">จำนวน (base)</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">ทุน/หน่วย</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">รวม</th>
              </tr>
            </thead>
            <tbody>
              {purchase.items.map((item) => (
                <>
                  <tr key={item.id} className="border-t border-gray-50">
                    <td className="px-3 py-2 font-mono text-xs text-gray-500">{item.product.code}</td>
                    <td className="px-3 py-2 text-gray-800">
                      {item.product.name}
                      {item.product.isLotControl && (
                        <span className="ml-2 inline-flex rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                          Lot
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">{item.quantity}</td>
                    <td className="px-3 py-2 text-right text-gray-700">
                      {Number(item.costPrice).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-gray-900">
                      {Number(item.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                  {item.lotItems.length > 0 && (
                    <tr key={`lot-${item.id}`} className="bg-amber-50/50">
                      <td colSpan={5} className="px-6 py-2">
                        <div className="flex flex-wrap gap-2">
                          {item.lotItems.map((lot) => (
                            <div
                              key={lot.lotNo}
                              className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-white px-2 py-1 text-xs"
                            >
                              <span className="font-mono font-semibold text-amber-800">{lot.lotNo}</span>
                              <span className="text-gray-500">จำนวน</span>
                              <span className="font-medium text-gray-700">{Number(lot.qty)}</span>
                              {lot.expDate && (
                                <>
                                  <span className="text-gray-400">|</span>
                                  <span className="text-gray-500">EXP</span>
                                  <span className="text-gray-700">
                                    {new Date(lot.expDate).toLocaleDateString("th-TH-u-ca-gregory", {
                                      day: "2-digit",
                                      month: "2-digit",
                                      year: "numeric",
                                    })}
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
                  <td colSpan={4} className="px-3 py-2 text-right text-sm text-gray-500">ส่วนลด</td>
                  <td className="px-3 py-2 text-right text-red-500">
                    -{Number(purchase.discount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              )}
              {purchase.vatType !== "NO_VAT" && (
                <>
                  <tr>
                    <td colSpan={4} className="px-3 py-1 text-right text-sm text-gray-500">ยอดก่อนภาษี</td>
                    <td className="px-3 py-1 text-right text-gray-700">
                      {Number(purchase.subtotalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="px-3 py-1 text-right text-sm text-gray-500">VAT {Number(purchase.vatRate)}%</td>
                    <td className="px-3 py-1 text-right text-gray-700">
                      +{Number(purchase.vatAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </>
              )}
              <tr>
                <td colSpan={4} className="px-3 py-3 text-right font-semibold text-gray-700">ยอดสุทธิ</td>
                <td className="px-3 py-3 text-right text-base font-bold text-[#1e3a5f]">
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
