export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import Link from "next/link";
import { ChevronLeft, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import SalesDeliveryPrintDocument from "@/app/admin/_components/SalesDeliveryPrintDocument";
import AutoPrint from "@/components/shared/AutoPrint";
import { hasPermissionAccess } from "@/lib/access-control";
import { FulfillmentType, SalePaymentType, SaleType } from "@/lib/generated/prisma";
import { buildPromptPayQrDataUrl, getPrimaryTransferAccount, getTransferDocumentState } from "@/lib/payment-qr";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { SHIPPING_METHOD_LABEL, SHIPPING_STATUS_BADGE, SHIPPING_STATUS_LABEL } from "@/lib/shipping";
import PrintButton from "./PrintButton";

const paymentMethodLabel: Record<string, string> = {
  CASH: "เงินสด",
  TRANSFER: "โอนเงิน",
  CREDIT: "เครดิต",
};

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("th-TH-u-ca-gregory", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

const fmtNum = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const saleTypeLabel: Record<SaleType, string> = {
  RETAIL: "ปลีก",
  WHOLESALE: "ส่ง",
};

const saleTypeBadge: Record<SaleType, string> = {
  RETAIL: "bg-green-100 text-green-700",
  WHOLESALE: "bg-blue-100 text-blue-700",
};

const fulfillmentLabel: Record<FulfillmentType, string> = {
  PICKUP: "หน้าร้าน",
  DELIVERY: "จัดส่ง",
};

const fulfillmentBadge: Record<FulfillmentType, string> = {
  PICKUP: "bg-gray-100 text-gray-600",
  DELIVERY: "bg-purple-100 text-purple-700",
};

const paymentTypeLabel: Record<SalePaymentType, string> = {
  CASH_SALE: "ขายสด",
  CREDIT_SALE: "ขายเชื่อ",
};

const paymentTypeBadge: Record<SalePaymentType, string> = {
  CASH_SALE: "bg-emerald-100 text-emerald-700",
  CREDIT_SALE: "bg-orange-100 text-orange-700",
};

const SaleDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("sales.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canUpdate = hasPermissionAccess(role, permissions, "sales.update");
  const { id } = await params;

  const [sale, cfg, primaryTransferAccount] = await Promise.all([
    db.sale.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: { select: { code: true, name: true, reportUnitName: true, isLotControl: true } },
            lotItems: { select: { lotNo: true, qty: true } },
          },
        },
        user: { select: { name: true } },
        customer: { select: { id: true, name: true, phone: true, address: true } },
      },
    }),
    getSiteConfig(),
    getPrimaryTransferAccount(),
  ]);

  if (!sale) notFound();

  const dueDate = new Date(new Date(sale.saleDate).getTime() + (sale.creditTerm ?? 0) * 24 * 60 * 60 * 1000);
  const signerDisplayName = sale.signerName ?? sale.user?.name ?? "-";
  const transferDocumentState = getTransferDocumentState({
    paymentType: sale.paymentType,
    netAmount: Number(sale.netAmount),
    primaryTransferAccount,
  });
  const transferPrimaryAccount = transferDocumentState.shouldShowTransferSection ? primaryTransferAccount : null;
  const promptPayQrDataUrl = transferDocumentState.shouldGenerateQr
    ? await buildPromptPayQrDataUrl(primaryTransferAccount?.promptPayId, transferDocumentState.qrAmount)
    : null;

  return (
    <>
      <style>{`
        @page { margin: 0; }
        @media print {
          body * { visibility: hidden; }
          #receipt, #receipt * { visibility: visible; }
          #receipt {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            display: flex;
            flex-direction: column;
            min-height: 100vh;
          }
          .no-print { display: none !important; }
          .receipt-footer { margin-top: auto; }
        }
      `}</style>

      <div className="no-print">
        <div className="mb-6 flex items-center gap-2">
          <Link
            href="/admin/sales"
            className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f]"
          >
            <ChevronLeft size={16} /> รายการขาย
          </Link>
          <span className="text-gray-300">/</span>
          <span className="text-sm font-medium text-gray-700">{sale.saleNo}</span>
        </div>

        <div className="mb-6 rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between border-b border-gray-100 pb-3">
            <div className="flex items-center gap-3">
              <h1 className="font-kanit text-xl font-bold text-gray-900">สรุปข้อมูลใบขาย</h1>
              {sale.status === "CANCELLED" ? (
                <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">ยกเลิกแล้ว</span>
              ) : (
                <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">ใช้งาน</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {sale.status === "ACTIVE" && canUpdate ? (
                <Link
                  href={`/admin/sales/${id}/edit`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f]"
                >
                  <Pencil size={14} /> แก้ไข
                </Link>
              ) : null}
              <PrintButton label={sale.paymentType === "CREDIT_SALE" ? "พิมพ์ใบแจ้งหนี้" : "พิมพ์ใบเสร็จ"} />
            </div>
          </div>

          <Suspense fallback={null}>
            <AutoPrint />
          </Suspense>

          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
            <div>
              <p className="mb-1 text-gray-500">เลขที่ใบขาย</p>
              <p className="font-mono font-semibold text-[#1e3a5f]">{sale.saleNo}</p>
            </div>
            <div>
              <p className="mb-1 text-gray-500">วันที่</p>
              <p className="font-medium text-gray-900">{fmtDate(sale.saleDate)}</p>
            </div>
            <div>
              <p className="mb-1 text-gray-500">ลูกค้า</p>
              {sale.customer ? (
                <Link href={`/admin/customers/${sale.customer.id}`} className="font-medium text-[#1e3a5f] hover:underline">
                  {sale.customer.name}
                </Link>
              ) : (
                <p className="font-medium text-gray-900">{sale.customerName ?? "-"}</p>
              )}
            </div>
            <div>
              <p className="mb-1 text-gray-500">เบอร์โทร</p>
              <p className="font-medium text-gray-900">{sale.customer?.phone ?? sale.customerPhone ?? "-"}</p>
            </div>
            <div>
              <p className="mb-1 text-gray-500">ประเภทการขาย</p>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${saleTypeBadge[sale.saleType]}`}>
                {saleTypeLabel[sale.saleType]}
              </span>
            </div>
            <div>
              <p className="mb-1 text-gray-500">ประเภทการชำระ</p>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${paymentTypeBadge[sale.paymentType]}`}>
                {paymentTypeLabel[sale.paymentType]}
              </span>
            </div>
            <div>
              <p className="mb-1 text-gray-500">ช่องทางชำระ</p>
              <p className="font-medium text-gray-900">
                {sale.paymentType === "CREDIT_SALE"
                  ? "ขายเชื่อ"
                  : sale.paymentMethod
                    ? (paymentMethodLabel[sale.paymentMethod] ?? sale.paymentMethod)
                    : "-"}
              </p>
            </div>
            <div>
              <p className="mb-1 text-gray-500">การจัดส่ง</p>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${fulfillmentBadge[sale.fulfillmentType]}`}>
                {fulfillmentLabel[sale.fulfillmentType]}
              </span>
            </div>
            {sale.fulfillmentType === "DELIVERY" ? (
              <>
                <div>
                  <p className="mb-1 text-gray-500">สถานะจัดส่ง</p>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${SHIPPING_STATUS_BADGE[sale.shippingStatus]}`}>
                    {SHIPPING_STATUS_LABEL[sale.shippingStatus]}
                  </span>
                </div>
                <div>
                  <p className="mb-1 text-gray-500">ขนส่ง</p>
                  <p className="font-medium text-gray-900">{SHIPPING_METHOD_LABEL[sale.shippingMethod ?? "NONE"]}</p>
                </div>
                {sale.trackingNo ? (
                  <div>
                    <p className="mb-1 text-gray-500">เลข Tracking</p>
                    <p className="font-mono font-medium text-gray-900">{sale.trackingNo}</p>
                  </div>
                ) : null}
              </>
            ) : null}
            <div>
              <p className="mb-1 text-gray-500">ผู้บันทึก</p>
              <p className="font-medium text-gray-900">{sale.user?.name ?? "-"}</p>
            </div>
            {sale.fulfillmentType === "DELIVERY" && sale.shippingAddress ? (
              <div className="col-span-2 md:col-span-3">
                <p className="mb-1 text-gray-500">ที่อยู่จัดส่ง</p>
                <p className="font-medium text-gray-900">{sale.shippingAddress}</p>
              </div>
            ) : null}
            {sale.fulfillmentType === "DELIVERY" && sale.shippingFee !== null && Number(sale.shippingFee) > 0 ? (
              <div>
                <p className="mb-1 text-gray-500">ค่าจัดส่ง</p>
                <p className="font-medium text-gray-900">{fmtNum(Number(sale.shippingFee))} บาท</p>
              </div>
            ) : null}
            {sale.note ? (
              <div className="col-span-2 md:col-span-3">
                <p className="mb-1 text-gray-500">หมายเหตุ</p>
                <p className="font-medium text-gray-900">{sale.note}</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <SalesDeliveryPrintDocument
        sale={sale}
        shopConfig={cfg}
        dueDate={dueDate}
        signerDisplayName={signerDisplayName}
        transferPrimaryAccount={transferPrimaryAccount}
        promptPayQrDataUrl={promptPayQrDataUrl}
        qrAmount={transferDocumentState.qrAmount}
        rootId="receipt"
      />
    </>
  );
};

export default SaleDetailPage;
