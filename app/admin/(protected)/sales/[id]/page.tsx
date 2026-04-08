export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import Link from "next/link";
import { ChevronLeft, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import PrintButton from "./PrintButton";
import AutoPrint from "@/components/shared/AutoPrint";
import { FulfillmentType, SalePaymentType, SaleType } from "@/lib/generated/prisma";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { SHIPPING_STATUS_LABEL, SHIPPING_STATUS_BADGE, SHIPPING_METHOD_LABEL } from "@/lib/shipping";

const paymentMethodLabel: Record<string, string> = {
  CASH:     "เงินสด",
  TRANSFER: "โอนเงิน",
  CREDIT:   "เครดิต",
};

const PAYMENT_PRINT_LABELS: { key: string; label: string }[] = [
  { key: "CASH",     label: "เงินสด" },
  { key: "TRANSFER", label: "เงินโอน" },
];

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("th-TH-u-ca-gregory", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

const fmtNum = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  await requirePermission("sales.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canUpdate = hasPermissionAccess(role, permissions, "sales.update");
  const { id } = await params;
  const [sale, cfg] = await Promise.all([
    db.sale.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product:  { select: { code: true, name: true, reportUnitName: true, isLotControl: true } },
            lotItems: { select: { lotNo: true, qty: true } },
          },
        },
        user:     { select: { name: true } },
        customer: { select: { id: true, name: true, phone: true } },
      },
    }),
    getSiteConfig(),
  ]);

  if (!sale) notFound();

  const dueDate =
    sale.paymentType === "CREDIT_SALE" && sale.creditTerm && sale.creditTerm > 0
      ? new Date(new Date(sale.saleDate).getTime() + sale.creditTerm * 24 * 60 * 60 * 1000)
      : null;

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
              {sale.status === "ACTIVE" && canUpdate && (
                <Link href={`/admin/sales/${id}/edit`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 hover:border-[#1e3a5f] text-gray-600 hover:text-[#1e3a5f] rounded-lg transition-colors">
                  <Pencil size={14} /> แก้ไข
                </Link>
              )}
              <PrintButton label={sale.paymentType === "CREDIT_SALE" ? "พิมพ์ใบแจ้งหนี้" : "พิมพ์ใบเสร็จ"} />
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
            {sale.fulfillmentType === "DELIVERY" && (
              <>
                <div>
                  <p className="text-gray-500 mb-1">สถานะจัดส่ง</p>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${SHIPPING_STATUS_BADGE[sale.shippingStatus]}`}>
                    {SHIPPING_STATUS_LABEL[sale.shippingStatus]}
                  </span>
                </div>
                <div>
                  <p className="text-gray-500 mb-1">ขนส่ง</p>
                  <p className="font-medium text-gray-900">{SHIPPING_METHOD_LABEL[sale.shippingMethod ?? "NONE"]}</p>
                </div>
                {sale.trackingNo && (
                  <div>
                    <p className="text-gray-500 mb-1">เลข Tracking</p>
                    <p className="font-medium text-gray-900 font-mono">{sale.trackingNo}</p>
                  </div>
                )}
              </>
            )}
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

      {/* ─── Print Area ─────────────────────────────────────────── */}
      <div id="receipt" className="bg-white p-8 mx-auto text-[13px] leading-snug" style={{ maxWidth: "900px" }}>

        {/* 1. Shop header — contact info only, no shop name */}
        <div className="flex justify-between items-start mb-4 pb-3 border-b-2 border-gray-800">
          <div className="text-xs text-gray-600 space-y-0.5">
            {cfg.shopAddress && <p>{cfg.shopAddress}</p>}
            {cfg.shopPhone && <p>โทร: {cfg.shopPhone}</p>}
            {cfg.shopWebsiteUrl && <p>{cfg.shopWebsiteUrl}</p>}
            {cfg.shopLineId && <p>Line: {cfg.shopLineId}</p>}
          </div>
          <div className="text-right">
            <p className="text-base font-bold border border-gray-700 px-6 py-1.5 inline-block">
              {sale.paymentType === "CREDIT_SALE" ? "ใบแจ้งหนี้ / ใบส่งของ" : "ใบเสร็จรับเงิน"}
            </p>
            <p className="text-xs font-mono text-gray-400 mt-1">{sale.saleNo}</p>
          </div>
        </div>

        {/* 2. Customer + Doc info */}
        <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
          {/* Customer */}
          <div className="border border-gray-400 rounded p-2 space-y-0.5">
            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">ข้อมูลลูกค้า</p>
            <p>
              <span className="text-gray-500">ชื่อ: </span>
              <span className="font-semibold">{sale.customerName ?? "-"}</span>
            </p>
            {(sale.customerPhone ?? sale.customer?.phone) && (
              <p>
                <span className="text-gray-500">โทร: </span>
                {sale.customerPhone ?? sale.customer?.phone}
              </p>
            )}
            {sale.paymentType === "CREDIT_SALE" && sale.shippingAddress && (
              <p>
                <span className="text-gray-500">ที่อยู่จัดส่ง: </span>
                {sale.shippingAddress}
              </p>
            )}
          </div>

          {/* Doc info — วันที่ และ พนักงานขาย ตัดออก */}
          <div className="border border-gray-400 rounded p-2">
            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">ข้อมูลเอกสาร</p>
            <table className="w-full text-xs">
              <tbody>
                <tr>
                  <td className="text-gray-500 pr-2 py-0.5 whitespace-nowrap">เลขที่เอกสาร</td>
                  <td className="font-mono font-semibold">{sale.saleNo}</td>
                </tr>
                <tr>
                  <td className="text-gray-500 pr-2 py-0.5 whitespace-nowrap">เงื่อนไขชำระ</td>
                  <td>{sale.creditTerm ? `${sale.creditTerm} วัน` : "ชำระทันที"}</td>
                </tr>
                {dueDate && (
                  <tr>
                    <td className="text-gray-500 pr-2 py-0.5 whitespace-nowrap">วันครบกำหนด</td>
                    <td>{fmtDate(dueDate)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 3. Items table */}
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-gray-100 text-gray-700">
              <th className="border border-gray-400 px-1.5 py-1.5 text-center w-7">#</th>
              <th className="border border-gray-400 px-1.5 py-1.5 text-left w-24">รหัสสินค้า</th>
              <th className="border border-gray-400 px-1.5 py-1.5 text-left">รายละเอียด</th>
              <th className="border border-gray-400 px-1.5 py-1.5 text-center w-12">จำนวน</th>
              <th className="border border-gray-400 px-1.5 py-1.5 text-center w-12">หน่วย</th>
              <th className="border border-gray-400 px-1.5 py-1.5 text-right w-24">ราคา/หน่วย</th>
              <th className="border border-gray-400 px-1.5 py-1.5 text-right w-24">ยอดรวม</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((item, idx) => (
              <tr key={item.id}>
                <td className="border border-gray-300 px-1.5 py-1.5 text-center text-gray-500">{idx + 1}</td>
                <td className="border border-gray-300 px-1.5 py-1.5 font-mono text-gray-500 whitespace-nowrap">{item.product.code}</td>
                <td className="border border-gray-300 px-1.5 py-1.5">
                  <div className="font-medium text-gray-900">{item.product.name}</div>
                  {item.lotItems.length > 0 && (
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      Lot: {item.lotItems.map((l) => `${l.lotNo} ×${Number(l.qty)}`).join(", ")}
                    </div>
                  )}
                </td>
                <td className="border border-gray-300 px-1.5 py-1.5 text-center">{item.quantity}</td>
                <td className="border border-gray-300 px-1.5 py-1.5 text-center text-gray-500">{item.product.reportUnitName}</td>
                <td className="border border-gray-300 px-1.5 py-1.5 text-right">{fmtNum(Number(item.salePrice))}</td>
                <td className="border border-gray-300 px-1.5 py-1.5 text-right font-medium">{fmtNum(Number(item.totalAmount))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* 4. Note + Summary */}
        <div className="flex border-l border-r border-b border-gray-400 mb-4 text-xs">
          <div className="flex-1 border-r border-gray-400 p-2">
            <p className="text-gray-400 mb-1">หมายเหตุ:</p>
            <p className="text-gray-700 min-h-[2rem]">{sale.note ?? ""}</p>
          </div>
          <div className="w-56 p-2 space-y-0.5">
            <div className="flex justify-between">
              <span className="text-gray-500">มูลค่ารวม</span>
              <span>{fmtNum(Number(sale.totalAmount))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">ส่วนลด</span>
              <span>{fmtNum(Number(sale.discount))}</span>
            </div>
            {Number(sale.shippingFee) > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500">ค่าจัดส่ง</span>
                <span>{fmtNum(Number(sale.shippingFee))}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-gray-400 pt-1 font-bold text-gray-900">
              <span>ยอดสุทธิ</span>
              <span className="text-[#1e3a5f]">{fmtNum(Number(sale.netAmount))}</span>
            </div>
          </div>
        </div>

        {/* 5. Payment checkboxes (cash sales only) — เงินสด / เงินโอน */}
        {sale.paymentType === "CASH_SALE" && (
          <div className="border border-gray-400 px-3 py-2 mb-5 text-xs flex items-center gap-6">
            <span className="text-gray-500 whitespace-nowrap">ชำระโดย:</span>
            {PAYMENT_PRINT_LABELS.map(({ key, label }) => (
              <span key={key} className="flex items-center gap-1.5">
                <span className="inline-flex w-4 h-4 items-center justify-center border border-gray-500 text-[11px]">
                  {sale.paymentMethod === key ? "✓" : ""}
                </span>
                {label}
              </span>
            ))}
          </div>
        )}

        {/* 6. Signature — กรอบสี่เหลี่ยม ด้านล่างสุด */}
        {sale.paymentType === "CREDIT_SALE" ? (
          <div className="grid grid-cols-3 gap-0 border border-gray-400 text-xs text-center">
            {["ผู้มีอำนาจลงนาม", "ผู้ส่งของ", "ผู้รับของ"].map((label, i) => (
              <div key={label} className={`${i < 2 ? "border-r border-gray-400" : ""}`}>
                <div className="h-16" />
                <div className="border-t border-gray-400 py-1.5 font-medium text-gray-700">{label}</div>
                <div className="text-gray-400 pb-2">วันที่ ...............</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-0 border border-gray-400 text-xs text-center">
            {["ผู้รับเงิน", "ผู้รับของ"].map((label, i) => (
              <div key={label} className={`${i < 1 ? "border-r border-gray-400" : ""}`}>
                <div className="h-16" />
                <div className="border-t border-gray-400 py-1.5 font-medium text-gray-700">{label}</div>
                <div className="text-gray-400 pb-2">วันที่ ...............</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default SaleDetailPage;
