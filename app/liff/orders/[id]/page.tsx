import Link from "next/link";
import { BadgeDollarSign, ChevronLeft, FileText, Package, ReceiptText, Truck } from "lucide-react";
import { notFound } from "next/navigation";

import OrderStatusTimeline from "@/components/liff/OrderStatusTimeline";
import TrackingSmartLink from "@/components/liff/TrackingSmartLink";
import { db } from "@/lib/db";
import { isTrackingExpired } from "@/lib/delivery-tracking";
import { requireLiffCustomer } from "@/lib/liff-data";
import { formatDateThai } from "@/lib/th-date";
import InlineDeliveryTracker from "./InlineDeliveryTracker";
import PaymentHistory from "./PaymentHistory";

const money = (value: unknown) =>
  Number(value ?? 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const shippingStatusLabel: Record<string, string> = {
  PENDING: "รอจัดส่ง",
  PREPARING: "เตรียมสินค้า",
  OUT_FOR_DELIVERY: "กำลังจัดส่ง",
  DELIVERED: "จัดส่งแล้ว",
  CANCELLED: "ยกเลิก",
};

export default async function LiffOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, customer] = await Promise.all([params, requireLiffCustomer()]);
  const [order, activeReceipt] = await Promise.all([
    db.sale.findFirst({
      where: {
        id,
        customerId: customer.id,
        status: "ACTIVE",
      },
      select: {
        id: true,
        saleNo: true,
        saleDate: true,
        subtotalAmount: true,
        discount: true,
        vatAmount: true,
        netAmount: true,
        amountRemain: true,
        paymentType: true,
        fulfillmentType: true,
        shippingMethod: true,
        shippingStatus: true,
        shippingAddress: true,
        trackingNo: true,
        trackingToken: true,
        trackingExpiry: true,
        destLatitude: true,
        destLongitude: true,
        deliveryTracking: {
          select: { latitude: true, longitude: true, accuracy: true, updatedAt: true },
        },
        deliveryStaff: { select: { name: true, phone: true } },
        items: {
          select: {
            id: true,
            product: { select: { name: true, saleUnitName: true } },
            quantity: true,
            salePrice: true,
            totalAmount: true,
          },
          orderBy: { id: "asc" },
        },
      },
    }),
    // Query only active receipt for receiptHref (lazy load full history in PaymentHistory)
    db.receiptItem.findFirst({
      where: {
        sale: {
          id,
          customerId: customer.id,
          status: "ACTIVE",
        },
        receipt: { status: "ACTIVE" },
      },
      select: {
        receipt: { select: { id: true } },
      },
    }),
  ]);

  if (!order) notFound();

  const paymentReceiptRows =
    order.paymentType === "CREDIT_SALE"
      ? await db.receipt.findMany({
          where: {
            status: "ACTIVE",
            items: {
              some: {
                sale: {
                  id: order.id,
                  customerId: customer.id,
                  status: "ACTIVE",
                },
              },
            },
          },
          select: {
            id: true,
            receiptNo: true,
            receiptDate: true,
            paymentMethod: true,
            status: true,
            cancelNote: true,
            items: {
              where: { saleId: order.id },
              select: {
                id: true,
                paidAmount: true,
              },
            },
          },
          orderBy: { receiptDate: "desc" },
          take: 10,
        })
      : [];
  const paymentHistoryReceipts = paymentReceiptRows.flatMap((receipt) =>
    receipt.items.map((item) => ({
      id: item.id,
      paidAmount: Number(item.paidAmount),
      receipt: {
        id: receipt.id,
        receiptNo: receipt.receiptNo,
        receiptDate: receipt.receiptDate.toISOString(),
        paymentMethod: receipt.paymentMethod,
        status: receipt.status,
        cancelNote: receipt.cancelNote,
      },
    })),
  );

  const showLiveTracking =
    order.fulfillmentType === "DELIVERY" &&
    order.shippingStatus === "OUT_FOR_DELIVERY" &&
    !!order.trackingToken &&
    !isTrackingExpired(order.trackingExpiry) &&
    order.destLatitude !== null &&
    order.destLongitude !== null;

  const destLat = order.destLatitude ?? null;
  const destLon = order.destLongitude ?? null;

  const liveDriver = order.deliveryTracking
    ? {
        lat: order.deliveryTracking.latitude,
        lon: order.deliveryTracking.longitude,
        accuracy: order.deliveryTracking.accuracy,
        updatedAt: order.deliveryTracking.updatedAt.toISOString(),
      }
    : null;

  const remain = Number(order.amountRemain ?? 0);
  const receiptHref = `/liff/orders/${order.id}/receipt${
    order.paymentType === "CREDIT_SALE" ? `?receiptId=${activeReceipt?.receipt.id ?? ""}` : ""
  }`;

  return (
    <main className="min-h-dvh bg-gradient-to-b from-white via-sky-50 to-white pb-24 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <section className="overflow-hidden rounded-b-[32px] border-b border-blue-100 bg-gradient-to-br from-white via-sky-50 to-emerald-50 px-5 pb-5 pt-6 text-[#083a78] shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 dark:text-sky-200">
        <Link href="/liff/orders" className="mb-5 inline-flex items-center gap-1 text-sm font-semibold text-blue-700 dark:text-sky-400">
          <ChevronLeft size={16} />
          กลับไปหน้าบิล
        </Link>
        <p className="font-mono text-sm text-slate-500 dark:text-slate-400">{order.saleNo}</p>
        <h1 className="mt-1 font-kanit text-2xl font-bold dark:text-slate-100">รายละเอียดบิล</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{formatDateThai(order.saleDate)}</p>
      </section>

      <section className="space-y-4 px-5 py-5">
        <div className="rounded-[24px] border border-blue-100 bg-white p-4 shadow-sm shadow-blue-950/5 dark:border-slate-700 dark:bg-slate-900">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">ยอดบิล</p>
              <p className="font-kanit text-2xl font-bold text-slate-950 dark:text-slate-100">{money(order.netAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">ต้องชำระ</p>
              <p className={`font-kanit text-2xl font-bold ${remain > 0 ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                {money(remain)}
              </p>
            </div>
          </div>
          <div className={`mt-4 flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-semibold ${remain > 0 ? "bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-300" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"}`}>
            <BadgeDollarSign className="h-4 w-4" />
            {remain > 0 ? "บิลนี้ยังมียอดที่ต้องชำระ" : "บิลนี้ชำระเรียบร้อยแล้ว"}
          </div>
        </div>

        <div className="rounded-[24px] border border-blue-100 bg-gradient-to-br from-white via-sky-50 to-emerald-50 p-4 shadow-sm shadow-blue-950/5 dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800">
          <div className="mb-3 flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-700 dark:text-sky-400" />
            <h2 className="font-kanit text-lg font-bold text-slate-950 dark:text-slate-100">เอกสารของฉัน</h2>
          </div>
          <div className="grid gap-2">
            {order.paymentType === "CASH_SALE" ? (
              <Link
                href={receiptHref}
                className="flex items-center justify-between rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:border-blue-300 hover:text-blue-800 active:scale-[0.99] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-sky-600 dark:hover:text-sky-300"
              >
                <span>ดู/บันทึกใบเสร็จรับเงิน</span>
                <FileText size={16} />
              </Link>
            ) : (
              <>
                <Link
                  href={`/liff/orders/${order.id}/invoice`}
                  className="flex items-center justify-between rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:border-blue-300 hover:text-blue-800 active:scale-[0.99] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-sky-600 dark:hover:text-sky-300"
                >
                  <span>ดู/บันทึกใบแจ้งหนี้ / ใบส่งของ</span>
                  <FileText size={16} />
                </Link>
                {activeReceipt ? (
                  <Link
                    href={receiptHref}
                    className="flex items-center justify-between rounded-2xl border border-blue-100 bg-white px-4 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:border-blue-300 hover:text-blue-800 active:scale-[0.99] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-sky-600 dark:hover:text-sky-300"
                  >
                    <span>ดู/บันทึกใบเสร็จรับเงิน</span>
                    <FileText size={16} />
                  </Link>
                ) : (
                  <p className="rounded-2xl border border-dashed border-blue-100 bg-white/80 px-4 py-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-400">
                    ใบเสร็จจะแสดงหลังมีการรับชำระจากร้าน
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        <div className="rounded-[24px] border border-blue-100 bg-white p-4 shadow-sm shadow-blue-950/5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center gap-2">
            <Truck className="h-5 w-5 text-blue-700 dark:text-sky-400" />
            <h2 className="font-kanit text-lg font-bold text-slate-950 dark:text-slate-100">สถานะบิล</h2>
          </div>
          <OrderStatusTimeline
            saleDate={order.saleDate}
            fulfillmentType={order.fulfillmentType}
            shippingStatus={order.shippingStatus}
            paid={remain <= 0}
          />
        </div>

        <div className="rounded-[24px] border border-blue-100 bg-white p-4 shadow-sm shadow-blue-950/5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center gap-2">
            <Truck className="h-5 w-5 text-blue-700 dark:text-sky-400" />
            <h2 className="font-kanit text-lg font-bold text-slate-950 dark:text-slate-100">
              {showLiveTracking ? "ติดตามการจัดส่ง" : "ข้อมูลจัดส่ง"}
            </h2>
          </div>

          {showLiveTracking ? (
            <InlineDeliveryTracker
              token={order.trackingToken!}
              destLat={destLat}
              destLon={destLon}
              driver={liveDriver}
              driverName={order.deliveryStaff?.name ?? null}
              driverPhone={order.deliveryStaff?.phone ?? null}
            />
          ) : (
            <>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                {shippingStatusLabel[order.shippingStatus] ?? order.shippingStatus}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                วิธีรับสินค้า: {order.fulfillmentType === "DELIVERY" ? "จัดส่ง" : "รับหน้าร้าน"}
              </p>
              <TrackingSmartLink shippingMethod={order.shippingMethod} trackingNo={order.trackingNo} />
            </>
          )}
        </div>

        <div className="rounded-[24px] border border-blue-100 bg-white p-4 shadow-sm shadow-blue-950/5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center gap-2">
            <Package className="h-5 w-5 text-blue-700 dark:text-sky-400" />
            <h2 className="font-kanit text-lg font-bold text-slate-950 dark:text-slate-100">รายการสินค้า</h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {order.items.map((item) => (
              <div key={item.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-slate-200">{item.product.name}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {Number(item.quantity).toLocaleString("th-TH")} {item.product.saleUnitName} x {money(item.salePrice)}
                    </p>
                  </div>
                  <p className="shrink-0 font-bold text-slate-950 dark:text-slate-100">{money(item.totalAmount)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {order.paymentType === "CREDIT_SALE" ? (
          <PaymentHistory saleId={order.id} initialReceipts={paymentHistoryReceipts} />
        ) : null}
      </section>
    </main>
  );
}
