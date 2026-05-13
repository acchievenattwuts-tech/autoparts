import Link from "next/link";
import { BadgeDollarSign, ChevronRight, ReceiptText, Store, Truck } from "lucide-react";

import LiffBottomNav from "@/components/liff/LiffBottomNav";
import { db } from "@/lib/db";
import { requireLiffCustomer } from "@/lib/liff-data";
import { SHIPPING_STATUS_BADGE, SHIPPING_STATUS_LABEL } from "@/lib/shipping";
import { formatDateThai } from "@/lib/th-date";

const money = (value: unknown) =>
  Number(value ?? 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default async function LiffOrdersPage() {
  const customer = await requireLiffCustomer();
  const orders = await db.sale.findMany({
    where: {
      customerId: customer.id,
      status: "ACTIVE",
    },
    select: {
      id: true,
      saleNo: true,
      saleDate: true,
      netAmount: true,
      amountRemain: true,
      paymentType: true,
      fulfillmentType: true,
      shippingStatus: true,
      _count: { select: { items: true } },
    },
    orderBy: { saleDate: "desc" },
    take: 50,
  });

  const outstandingCount = orders.filter((order) => Number(order.amountRemain ?? 0) > 0).length;
  const totalOutstanding = orders.reduce((sum, order) => sum + Number(order.amountRemain ?? 0), 0);
  const inDeliveryCount = orders.filter(
    (order) => order.fulfillmentType === "DELIVERY" && order.shippingStatus === "OUT_FOR_DELIVERY",
  ).length;

  return (
    <main className="min-h-dvh bg-gradient-to-b from-white via-sky-50 to-white pb-24">
      <section className="overflow-hidden rounded-b-[32px] border-b border-blue-100 bg-gradient-to-br from-white via-sky-50 to-emerald-50 px-5 pb-6 pt-6 text-[#083a78] shadow-sm">
        <p className="text-sm font-semibold text-blue-700">สวัสดีคุณ</p>
        <h1 className="mt-1 font-kanit text-2xl font-bold tracking-normal">{customer.name}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {outstandingCount > 0
            ? `มีบิลที่ต้องชำระ ${outstandingCount} รายการ`
            : "ตอนนี้ไม่มีบิลที่ต้องชำระ"}
          {inDeliveryCount > 0 ? ` · กำลังจัดส่ง ${inDeliveryCount} รายการ` : ""}
        </p>

        <Link
          href="/liff/outstanding"
          className="mt-5 block rounded-[24px] border border-blue-100 bg-white/90 px-4 py-4 text-slate-950 shadow-sm transition active:scale-[0.99]"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-600">ยอดที่ต้องชำระ</p>
              <p className={`mt-1 font-kanit text-3xl font-extrabold ${totalOutstanding > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                {money(totalOutstanding)}
              </p>
              <p className="mt-1 text-xs text-slate-500">แตะเพื่อดูช่องทางชำระเงิน</p>
            </div>
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e9f8f0] text-[#06c755]">
              <BadgeDollarSign className="h-5 w-5" />
            </span>
          </div>
        </Link>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link href="/liff/orders" className="rounded-2xl border border-blue-100 bg-white/80 px-3 py-3 shadow-sm transition active:scale-[0.99]">
            <ReceiptText className="mb-2 h-5 w-5 text-blue-700" />
            <p className="text-[11px] font-semibold text-slate-500">บิลทั้งหมด</p>
            <p className="font-kanit text-xl font-bold text-blue-950">{orders.length}</p>
          </Link>
          <Link href="/liff/orders" className="rounded-2xl border border-blue-100 bg-white/80 px-3 py-3 shadow-sm transition active:scale-[0.99]">
            <Truck className="mb-2 h-5 w-5 text-blue-700" />
            <p className="text-[11px] font-semibold text-slate-500">กำลังจัดส่ง</p>
            <p className="font-kanit text-xl font-bold text-blue-950">{inDeliveryCount}</p>
          </Link>
        </div>
      </section>

      <section className="px-5 py-5">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="font-kanit text-xl font-bold text-slate-950">รายการล่าสุด</h2>
            <p className="text-xs text-slate-500">บิลและสถานะล่าสุดของคุณ</p>
          </div>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-800">
            {orders.length} บิล
          </span>
        </div>

        <div className="space-y-3">
          {orders.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-blue-200 bg-white px-4 py-10 text-center text-sm text-slate-500 shadow-sm">
              <ReceiptText className="mx-auto mb-3 h-8 w-8 text-blue-300" />
              ยังไม่มีประวัติการซื้อ
            </div>
          ) : (
            orders.map((order) => {
              const remain = Number(order.amountRemain ?? 0);
              const isPaidSale = remain <= 0;
              const isPickup = order.fulfillmentType === "PICKUP";
              return (
                <Link
                  key={order.id}
                  href={`/liff/orders/${order.id}`}
                  className="block rounded-[24px] border border-blue-100 bg-white p-4 shadow-sm shadow-blue-950/5 transition active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-bold text-slate-950">{order.saleNo}</p>
                      <p className="mt-1 text-xs text-slate-500">{formatDateThai(order.saleDate)}</p>
                      {isPickup ? (
                        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-bold text-violet-800">
                          <Store size={12} />
                          รับหน้าร้าน
                        </span>
                      ) : (
                        <span className={`mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${SHIPPING_STATUS_BADGE[order.shippingStatus] ?? "bg-slate-100 text-slate-700"}`}>
                          <Truck size={12} />
                          {SHIPPING_STATUS_LABEL[order.shippingStatus] ?? order.shippingStatus}
                        </span>
                      )}
                      {isPaidSale ? (
                        <span className="ml-1 mt-2 inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-800">
                          เรียบร้อยแล้ว
                        </span>
                      ) : null}
                    </div>
                    <ChevronRight className="mt-1 h-5 w-5 text-slate-400" />
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-slate-500">ยอดบิล</p>
                      <p className="font-bold text-slate-950">{money(order.netAmount)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">ต้องชำระ</p>
                      <p className={remain > 0 ? "font-bold text-rose-700" : "font-bold text-emerald-700"}>
                        {money(remain)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">สินค้า</p>
                      <p className="font-bold text-slate-950">{order._count.items}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2 text-xs">
                    <span className="font-semibold text-slate-600">
                      {remain > 0 ? "ดูรายละเอียดและช่องทางชำระ" : "เปิดเอกสารหรือดูรายการสินค้า"}
                    </span>
                    <span className="font-bold text-blue-800">ดูบิล</span>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </section>
      <LiffBottomNav active="/liff/orders" />
    </main>
  );
}
