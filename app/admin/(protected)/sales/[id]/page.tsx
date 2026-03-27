export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { ChevronLeft, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import PrintButton from "./PrintButton";
import AutoPrint from "@/components/shared/AutoPrint";
import { FulfillmentType, SalePaymentType, SaleType } from "@/lib/generated/prisma";

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
  CASH_SALE:   "ขายสด",
  CREDIT_SALE: "ขายเชื่อ",
};
const paymentTypeBadge: Record<SalePaymentType, string> = {
  CASH_SALE:   "bg-emerald-100 text-emerald-700",
  CREDIT_SALE: "bg-orange-100 text-orange-700",
};

const SaleDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const [sale, contents] = await Promise.all([
    db.sale.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: {
              select: { code: true, name: true, reportUnitName: true },
            },
          },
        },
        user:     { select: { name: true } },
        customer: { select: { id: true, name: true, phone: true } },
      },
    }),
    db.siteContent.findMany({
      where: { key: { in: ["shopName", "shopPhone", "shopAddress", "shopTaxId"] } },
    }),
  ]);

  if (!sale) notFound();

  const cfg = Object.fromEntries(contents.map((c) => [c.key, c.value]));

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #receipt, #receipt * { visibility: visible; }
          #receipt { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-6">
          <Link
            href="/admin/sales"
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors"
          >
            <ChevronLeft size={16} /> รายการขาย
          </Link>
          <span className="text-gray-300">/</span>
          <span className="text-sm font-medium text-gray-700">{sale.saleNo}</span>
        </div>

        {/* Summary card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
          <div className="flex items-center justify-between mb-5 pb-3 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <h1 className="font-kanit text-xl font-bold text-gray-900">สรุปข้อมูลใบขาย</h1>
              {sale.status === "CANCELLED" ? (
                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">ยกเลิกแล้ว</span>
              ) : (
                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">ใช้งาน</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {sale.status === "ACTIVE" && (
                <Link href={`/admin/sales/${id}/edit`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 hover:border-[#1e3a5f] text-gray-600 hover:text-[#1e3a5f] rounded-lg transition-colors">
                  <Pencil size={14} /> แก้ไข
                </Link>
              )}
              <PrintButton />
            </div>
          </div>
          <Suspense fallback={null}><AutoPrint /></Suspense>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-gray-500 mb-1">เลขที่ใบขาย</p>
              <p className="font-mono font-semibold text-[#1e3a5f]">{sale.saleNo}</p>
            </div>
            <div>
              <p className="text-gray-500 mb-1">วันที่</p>
              <p className="font-medium text-gray-900">
                {new Date(sale.saleDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
              </p>
            </div>
            <div>
              <p className="text-gray-500 mb-1">ลูกค้า</p>
              {sale.customer ? (
                <Link
                  href={`/admin/customers/${sale.customer.id}`}
                  className="font-medium text-[#1e3a5f] hover:underline"
                >
                  {sale.customer.name}
                </Link>
              ) : (
                <p className="font-medium text-gray-900">{sale.customerName ?? "-"}</p>
              )}
            </div>
            <div>
              <p className="text-gray-500 mb-1">เบอร์โทร</p>
              <p className="font-medium text-gray-900">
                {sale.customer?.phone ?? sale.customerPhone ?? "-"}
              </p>
            </div>
            <div>
              <p className="text-gray-500 mb-1">ประเภทการขาย</p>
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${saleTypeBadge[sale.saleType]}`}>
                {saleTypeLabel[sale.saleType]}
              </span>
            </div>
            <div>
              <p className="text-gray-500 mb-1">ประเภทการชำระ</p>
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${paymentTypeBadge[sale.paymentType]}`}>
                {paymentTypeLabel[sale.paymentType]}
              </span>
            </div>
            <div>
              <p className="text-gray-500 mb-1">ช่องทางชำระ</p>
              <p className="font-medium text-gray-900">
                {sale.paymentType === "CREDIT_SALE"
                  ? "ขายเชื่อ"
                  : sale.paymentMethod
                    ? (paymentMethodLabel[sale.paymentMethod] ?? sale.paymentMethod)
                    : "-"}
              </p>
            </div>
            <div>
              <p className="text-gray-500 mb-1">การจัดส่ง</p>
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${fulfillmentBadge[sale.fulfillmentType]}`}>
                {fulfillmentLabel[sale.fulfillmentType]}
              </span>
            </div>
            <div>
              <p className="text-gray-500 mb-1">ผู้บันทึก</p>
              <p className="font-medium text-gray-900">{sale.user?.name ?? "-"}</p>
            </div>
            {sale.fulfillmentType === "DELIVERY" && sale.shippingAddress && (
              <div className="col-span-2 md:col-span-3">
                <p className="text-gray-500 mb-1">ที่อยู่จัดส่ง</p>
                <p className="font-medium text-gray-900">{sale.shippingAddress}</p>
              </div>
            )}
            {sale.fulfillmentType === "DELIVERY" && sale.shippingFee !== null && Number(sale.shippingFee) > 0 && (
              <div>
                <p className="text-gray-500 mb-1">ค่าจัดส่ง</p>
                <p className="font-medium text-gray-900">
                  {Number(sale.shippingFee).toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท
                </p>
              </div>
            )}
            {sale.note && (
              <div className="col-span-2 md:col-span-3">
                <p className="text-gray-500 mb-1">หมายเหตุ</p>
                <p className="font-medium text-gray-900">{sale.note}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Print area */}
      <div id="receipt" className="bg-white p-8 max-w-2xl mx-auto">
        {/* Shop header */}
        <div className="text-center mb-6">
          <h2 className="text-xl font-bold text-gray-900">
            {cfg.shopName ?? "ร้านอะไหล่รถยนต์"}
          </h2>
          {cfg.shopAddress && (
            <p className="text-sm text-gray-600 mt-1">{cfg.shopAddress}</p>
          )}
          {cfg.shopPhone && (
            <p className="text-sm text-gray-600">โทร: {cfg.shopPhone}</p>
          )}
          {cfg.shopTaxId && (
            <p className="text-sm text-gray-600">เลขประจำตัวผู้เสียภาษี: {cfg.shopTaxId}</p>
          )}
        </div>

        <div className="text-center mb-6">
          <h3 className="text-lg font-bold border-t border-b border-gray-300 py-2 inline-block px-8">
            ใบเสร็จรับเงิน
          </h3>
        </div>

        {/* Sale info */}
        <div className="grid grid-cols-2 gap-x-4 mb-4 text-sm">
          <div>
            <span className="text-gray-600">เลขที่: </span>
            <span className="font-semibold">{sale.saleNo}</span>
          </div>
          <div className="text-right">
            <span className="text-gray-600">วันที่: </span>
            <span className="font-semibold">
              {new Date(sale.saleDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
            </span>
          </div>
          <div>
            <span className="text-gray-600">ลูกค้า: </span>
            <span className="font-semibold">{sale.customerName ?? "-"}</span>
          </div>
          {sale.customerPhone && (
            <div className="text-right">
              <span className="text-gray-600">โทร: </span>
              <span>{sale.customerPhone}</span>
            </div>
          )}
        </div>

        {/* Items table */}
        <table className="w-full text-sm mb-4 border-collapse">
          <thead>
            <tr className="border-t border-b border-gray-300">
              <th className="text-left py-2 font-medium text-gray-700 w-8">ลำดับ</th>
              <th className="text-left py-2 font-medium text-gray-700">รายการ</th>
              <th className="text-right py-2 font-medium text-gray-700 w-16">จำนวน</th>
              <th className="text-left py-2 font-medium text-gray-700 w-16 pl-2">หน่วย</th>
              <th className="text-right py-2 font-medium text-gray-700 w-24">ราคา/หน่วย</th>
              <th className="text-right py-2 font-medium text-gray-700 w-24">รวม</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((item, idx) => (
              <tr key={item.id} className="border-b border-gray-100">
                <td className="py-1.5 text-gray-600">{idx + 1}</td>
                <td className="py-1.5">
                  <div className="font-medium text-gray-900">{item.product.name}</div>
                  <div className="text-xs text-gray-400">{item.product.code}</div>
                </td>
                <td className="py-1.5 text-right text-gray-800">{item.quantity}</td>
                <td className="py-1.5 pl-2 text-gray-600">{item.product.reportUnitName}</td>
                <td className="py-1.5 text-right text-gray-800">
                  {Number(item.salePrice).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </td>
                <td className="py-1.5 text-right font-medium text-gray-900">
                  {Number(item.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Summary */}
        <div className="flex justify-end mb-6">
          <div className="w-56 space-y-1 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>ยอดรวม</span>
              <span>{Number(sale.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
            </div>
            {sale.shippingFee !== null && Number(sale.shippingFee) > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>ค่าจัดส่ง</span>
                <span>+{Number(sale.shippingFee).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
              </div>
            )}
            <div className="flex justify-between text-gray-600">
              <span>ส่วนลด</span>
              <span>-{Number(sale.discount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between border-t border-gray-300 pt-1 font-bold text-gray-900">
              <span>ยอดสุทธิ</span>
              <span className="text-[#1e3a5f] text-base">
                {Number(sale.netAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between text-gray-600 pt-1">
              <span>การชำระเงิน</span>
              <span>
                {sale.paymentType === "CREDIT_SALE"
                  ? "ขายเชื่อ"
                  : sale.paymentMethod
                    ? (paymentMethodLabel[sale.paymentMethod] ?? sale.paymentMethod)
                    : "-"}
              </span>
            </div>
          </div>
        </div>

        <div className="text-center text-sm text-gray-500 border-t border-gray-200 pt-4">
          ขอบคุณที่ใช้บริการ
        </div>
      </div>
    </>
  );
};

export default SaleDetailPage;
