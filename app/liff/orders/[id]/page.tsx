import Link from "next/link";
import { ChevronLeft, FileText, Package, ReceiptText, Truck } from "lucide-react";
import { notFound } from "next/navigation";

import OrderStatusTimeline from "@/components/liff/OrderStatusTimeline";
import TrackingSmartLink from "@/components/liff/TrackingSmartLink";
import { db } from "@/lib/db";
import { requireLiffCustomer } from "@/lib/liff-data";
import { formatDateThai } from "@/lib/th-date";

const money = (value: unknown) =>
  Number(value ?? 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const shippingStatusLabel: Record<string, string> = {
  PENDING: "รอดำเนินการ",
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
  const order = await db.sale.findFirst({
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
      trackingNo: true,
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
      receipts: {
        select: {
          id: true,
          paidAmount: true,
          receipt: {
            select: {
              id: true,
              receiptNo: true,
              receiptDate: true,
              paymentMethod: true,
              status: true,
              cancelNote: true,
            },
          },
        },
        orderBy: { receipt: { receiptDate: "desc" } },
        take: 10,
      },
    },
  });

  if (!order) notFound();

  const remain = Number(order.amountRemain ?? 0);
  const activeReceipt = order.receipts.find((item) => item.receipt.status === "ACTIVE");
  const receiptHref = `/liff/orders/${order.id}/receipt${
    order.paymentType === "CREDIT_SALE" ? `?receiptId=${activeReceipt?.receipt.id ?? ""}` : ""
  }`;

  return (
    <main className="min-h-dvh bg-gradient-to-b from-white via-sky-50 to-white pb-24">
      <section className="overflow-hidden rounded-b-[28px] border-b border-blue-100 bg-gradient-to-br from-white via-sky-50 to-blue-100 px-5 pb-5 pt-6 text-[#083a78] shadow-sm">
        <Link href="/liff/orders" className="mb-5 inline-flex items-center gap-1 text-sm font-semibold text-blue-700">
          <ChevronLeft size={16} />
          กลับไปประวัติซื้อ
        </Link>
        <p className="font-mono text-sm text-slate-500">{order.saleNo}</p>
        <h1 className="mt-1 font-kanit text-2xl font-bold">รายละเอียดบิล</h1>
        <p className="mt-1 text-sm text-slate-600">{formatDateThai(order.saleDate)}</p>
      </section>

      <section className="space-y-4 px-5 py-5">
        <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-slate-500">ยอดรวม</p>
              <p className="font-kanit text-2xl font-bold text-slate-950">{money(order.netAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">คงค้าง</p>
              <p className={`font-kanit text-2xl font-bold ${remain > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                {money(remain)}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-white via-sky-50 to-blue-50 p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-700" />
            <h2 className="font-kanit text-lg font-bold text-slate-950">เอกสารของฉัน</h2>
          </div>
          <div className="grid gap-2">
            {order.paymentType === "CASH_SALE" ? (
              <Link
                href={receiptHref}
                className="flex items-center justify-between rounded-xl border border-blue-100 bg-white px-4 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:border-blue-300 hover:text-blue-800"
              >
                <span>ดู/บันทึกใบเสร็จรับเงิน</span>
                <FileText size={16} />
              </Link>
            ) : (
              <>
                <Link
                  href={`/liff/orders/${order.id}/invoice`}
                  className="flex items-center justify-between rounded-xl border border-blue-100 bg-white px-4 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:border-blue-300 hover:text-blue-800"
                >
                  <span>ดู/บันทึกใบแจ้งหนี้ / ใบส่งของ</span>
                  <FileText size={16} />
                </Link>
                {activeReceipt ? (
                  <Link
                    href={receiptHref}
                    className="flex items-center justify-between rounded-xl border border-blue-100 bg-white px-4 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:border-blue-300 hover:text-blue-800"
                  >
                    <span>ดู/บันทึกใบเสร็จรับเงิน</span>
                    <FileText size={16} />
                  </Link>
                ) : (
                  <p className="rounded-xl border border-dashed border-blue-100 bg-white/80 px-4 py-3 text-xs text-slate-500">
                    ใบเสร็จจะแสดงหลังมีการรับชำระจากร้าน
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Truck className="h-5 w-5 text-blue-700" />
            <h2 className="font-kanit text-lg font-bold text-slate-950">Timeline สถานะ</h2>
          </div>
          <OrderStatusTimeline
            saleDate={order.saleDate}
            fulfillmentType={order.fulfillmentType}
            shippingStatus={order.shippingStatus}
            paid={remain <= 0}
          />
        </div>

        <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Truck className="h-5 w-5 text-blue-700" />
            <h2 className="font-kanit text-lg font-bold text-slate-950">ข้อมูลจัดส่ง</h2>
          </div>
          <p className="text-sm font-semibold text-slate-800">
            {shippingStatusLabel[order.shippingStatus] ?? order.shippingStatus}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            วิธีรับสินค้า: {order.fulfillmentType === "DELIVERY" ? "จัดส่ง" : "รับหน้าร้าน"}
          </p>
          <TrackingSmartLink shippingMethod={order.shippingMethod} trackingNo={order.trackingNo} />
        </div>

        <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Package className="h-5 w-5 text-blue-700" />
            <h2 className="font-kanit text-lg font-bold text-slate-950">รายการสินค้า</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {order.items.map((item) => (
              <div key={item.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">{item.product.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {Number(item.quantity).toLocaleString("th-TH")} {item.product.saleUnitName} x {money(item.salePrice)}
                    </p>
                  </div>
                  <p className="shrink-0 font-bold text-slate-950">{money(item.totalAmount)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <ReceiptText className="h-5 w-5 text-blue-700" />
            <h2 className="font-kanit text-lg font-bold text-slate-950">ประวัติการชำระเงิน</h2>
          </div>
          {order.receipts.length === 0 ? (
            <p className="text-sm text-slate-500">ยังไม่มีใบเสร็จรับชำระสำหรับบิลนี้</p>
          ) : (
            <div className="space-y-2">
              {order.receipts.map((receipt) => (
                <div key={receipt.id} className="rounded-xl bg-blue-50/60 px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm font-bold text-slate-900">{receipt.receipt.receiptNo}</p>
                      <p className="text-xs text-slate-500">{formatDateThai(receipt.receipt.receiptDate)}</p>
                    </div>
                    <p className="font-bold text-slate-950">{money(receipt.paidAmount)}</p>
                  </div>
                  {receipt.receipt.status === "CANCELLED" ? (
                    <p className="mt-2 rounded-md bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">
                      ยกเลิก{receipt.receipt.cancelNote ? `: ${receipt.receipt.cancelNote}` : ""}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
