export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { SHIPPING_METHOD_LABEL } from "@/lib/shipping";
import AutoPrint from "@/components/shared/AutoPrint";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import PrintButton from "./PrintButton";

const DeliveryPrintPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) => {
  await requirePermission("delivery.view");
  const { ids } = await searchParams;

  if (!ids) notFound();

  const idList = ids.split(",").filter(Boolean).slice(0, 100);
  if (idList.length === 0) notFound();

  const [sales, contents] = await Promise.all([
    db.sale.findMany({
      where: { id: { in: idList }, fulfillmentType: "DELIVERY", status: "ACTIVE" },
      orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }],
      select: {
        id:              true,
        saleNo:          true,
        saleDate:        true,
        customerName:    true,
        customerPhone:   true,
        shippingAddress: true,
        shippingMethod:  true,
        trackingNo:      true,
        netAmount:       true,
        shippingFee:     true,
        paymentType:     true,
        amountRemain:    true,
        customer:        { select: { name: true, phone: true } },
        items: {
          select: {
            id:          true,
            quantity:    true,
            salePrice:   true,
            totalAmount: true,
            product: {
              select: { name: true, reportUnitName: true },
            },
          },
        },
      },
    }),
    db.siteContent.findMany({
      where: { key: { in: ["shopName", "shopPhone", "shopAddress"] } },
    }),
  ]);

  if (sales.length === 0) notFound();

  const cfg = Object.fromEntries(contents.map((c) => [c.key, c.value]));

  const fmt = (v: unknown) =>
    Number(v ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2 });

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .slip { page-break-after: always; }
          .slip:last-child { page-break-after: avoid; }
        }
        @media screen {
          body { background: #f3f4f6; }
          .slip { max-width: 680px; margin: 24px auto; background: white; padding: 32px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
        }
      `}</style>

      <div className="no-print flex items-center justify-between p-4 bg-white border-b sticky top-0 z-10">
        <span className="font-medium text-gray-700">ใบส่งของ {sales.length} ใบ</span>
        <PrintButton />
      </div>

      <Suspense fallback={null}><AutoPrint /></Suspense>

      {sales.map((sale) => {
        const customerName = sale.customer?.name ?? sale.customerName ?? "-";
        const customerPhone = sale.customer?.phone ?? sale.customerPhone ?? "-";
        const isCOD = sale.paymentType === "CREDIT_SALE";

        return (
          <div key={sale.id} className="slip">
            {/* Header */}
            <div className="flex justify-between items-start mb-4">
              <div>
                <p className="font-bold text-lg">{cfg.shopName ?? "ร้านค้า"}</p>
                {cfg.shopPhone && <p className="text-sm text-gray-600">โทร: {cfg.shopPhone}</p>}
                {cfg.shopAddress && <p className="text-sm text-gray-600">{cfg.shopAddress}</p>}
              </div>
              <div className="text-right">
                <p className="font-bold text-base">ใบส่งของ</p>
                <p className="font-mono text-sm text-[#1e3a5f]">{sale.saleNo}</p>
                <p className="text-sm text-gray-600">
                  {new Date(sale.saleDate).toLocaleDateString("th-TH-u-ca-gregory", {
                    day: "2-digit", month: "2-digit", year: "numeric",
                  })}
                </p>
              </div>
            </div>

            <hr className="my-3 border-gray-300" />

            {/* ที่อยู่จัดส่ง */}
            <div className="mb-4">
              <p className="text-xs text-gray-500 mb-1">จัดส่งให้</p>
              <p className="font-semibold">{customerName}</p>
              {customerPhone !== "-" && <p className="text-sm text-gray-600">โทร: {customerPhone}</p>}
              {sale.shippingAddress && (
                <p className="text-sm text-gray-600 mt-0.5 whitespace-pre-line">{sale.shippingAddress}</p>
              )}
              {sale.trackingNo && (
                <p className="text-sm mt-1">
                  <span className="text-gray-500">ขนส่ง:</span>{" "}
                  <span className="font-medium">{SHIPPING_METHOD_LABEL[sale.shippingMethod ?? "NONE"]}</span>
                  {" "}
                  <span className="font-mono font-semibold">{sale.trackingNo}</span>
                </p>
              )}
            </div>

            {/* รายการสินค้า */}
            <table className="w-full text-sm mb-4">
              <thead>
                <tr className="border-b border-gray-300">
                  <th className="text-left py-1 font-medium text-gray-600">รายการ</th>
                  <th className="text-center py-1 font-medium text-gray-600 w-20">จำนวน</th>
                  <th className="text-right py-1 font-medium text-gray-600 w-24">ราคา/หน่วย</th>
                  <th className="text-right py-1 font-medium text-gray-600 w-24">รวม</th>
                </tr>
              </thead>
              <tbody>
                {sale.items.map((item) => (
                  <tr key={item.id} className="border-b border-gray-100">
                    <td className="py-1">{item.product.name}</td>
                    <td className="py-1 text-center">
                      {Number(item.quantity).toLocaleString("th-TH")} {item.product.reportUnitName ?? ""}
                    </td>
                    <td className="py-1 text-right">{fmt(item.salePrice)}</td>
                    <td className="py-1 text-right">{fmt(item.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* ยอดรวม */}
            <div className="flex justify-end">
              <div className="w-48 text-sm space-y-1">
                {Number(sale.shippingFee ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">ค่าส่ง</span>
                    <span>฿{fmt(sale.shippingFee)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold border-t border-gray-300 pt-1">
                  <span>ยอดสุทธิ</span>
                  <span>฿{fmt(sale.netAmount)}</span>
                </div>
              </div>
            </div>

            {/* Footer COD / Pre-paid */}
            <div className={`mt-4 p-3 rounded text-center font-semibold text-sm ${
              isCOD ? "bg-orange-50 border border-orange-200 text-orange-700" : "bg-green-50 border border-green-200 text-green-700"
            }`}>
              {isCOD
                ? `กรุณาชำระ ฿${fmt(sale.amountRemain)}`
                : "ชำระแล้ว"}
            </div>

            {/* ลายเซ็น */}
            <div className="grid grid-cols-2 gap-8 mt-6 text-sm text-gray-500">
              <div>
                <p>ผู้ส่งของ .......................................</p>
                <p className="mt-1">วันที่ ........................................</p>
              </div>
              <div>
                <p>ผู้รับของ .......................................</p>
                <p className="mt-1">วันที่ ........................................</p>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
};

export default DeliveryPrintPage;
