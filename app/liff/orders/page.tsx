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
    <main className="min-h-dvh bg-gradient-to-b from-white via-sky-50 to-white pb-24 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <section className="overflow-hidden rounded-b-[32px] border-b border-blue-100 bg-gradient-to-br from-white via-sky-50 to-emerald-50 px-5 pb-6 pt-6 text-[#083a78] shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 dark:text-sky-200">
        <p className="text-sm font-semibold text-blue-700 dark:text-sky-400">สวัสดีคุณ</p>
        <h1 className="mt-1 font-kanit text-2xl font-bold tracking-normal dark:text-slate-100">{customer.name}</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          {outstandingCount > 0
            ? `มีบิลที่ต้องชำระ ${outstandingCount} รายการ`
            : "ตอนนี้ไม่มีบิลที่ต้องชำระ"}
          {inDeliveryCount > 0 ? ` · กำลังจัดส่ง ${inDeliveryCount} รายการ` : ""}
        </p>

        <Link
          href="/liff/outstanding"
          className="mt-5 block rounded-[24px] border border-blue-100 bg-white/90 px-4 py-4 text-slate-950 shadow-sm transition active:scale-[0.99] dark:border-slate-700 dark:bg-slate-800/90 dark:text-slate-100"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">ยอดที่ต้องชำระ</p>
              <p className={`mt-1 font-kanit text-3xl font-extrabold ${totalOutstanding > 0 ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                {money(totalOutstanding)}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">แตะเพื่อดูช่องทางชำระเงิน</p>
            </div>
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e9f8f0] text-[#06c755] dark:bg-emerald-950 dark:text-emerald-400">
              <BadgeDollarSign className="h-5 w-5" />
            </span>
          </div>
        </Link>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link href="/liff/orders" className="rounded-2xl border border-blue-100 bg-white/80 px-3 py-3 shadow-sm transition active:scale-[0.99] dark:border-slate-700 dark:bg-slate-800/80">
            <ReceiptText className="mb-2 h-5 w-5 text-blue-700 dark:text-sky-400" />
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">บิลทั้งหมด</p>
            <p className="font-kanit text-xl font-bold text-blue-950 dark:text-slate-100">{orders.length}</p>
          </Link>
          <Link href="/liff/orders" className="rounded-2xl border border-blue-100 bg-white/80 px-3 py-3 shadow-sm transition active:scale-[0.99] dark:border-slate-700 dark:bg-slate-800/80">
            <Truck className="mb-2 h-5 w-5 text-blue-700 dark:text-sky-400" />
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">กำลังจัดส่ง</p>
            <p className="font-kanit text-xl font-bold text-blue-950 dark:text-slate-100">{inDeliveryCount}</p>
          </Link>
        </div>
      </section>

      <section className="px-5 py-5">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="font-kanit text-xl font-bold text-slate-950 dark:text-slate-100">รายการล่าสุด</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">บิลและสถานะล่าสุดของคุณ</p>
          </div>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-800 dark:bg-slate-800 dark:text-sky-400">
            {orders.length} บิล
          </span>
        </div>

        <div className="space-y-3">
          {orders.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-blue-200 bg-white px-4 py-10 text-center text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              <ReceiptText className="mx-auto mb-3 h-8 w-8 text-blue-300 dark:text-slate-600" />
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
                  className="block rounded-[24px] border border-blue-100 bg-white p-4 shadow-sm shadow-blue-950/5 transition active:scale-[0.99] dark:border-slate-700 dark:bg-slate-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-bold text-slate-950 dark:text-slate-100">{order.saleNo}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formatDateThai(order.saleDate)}</p>
                      {isPickup ? (
                        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-bold text-violet-800 dark:bg-violet-950 dark:text-violet-300">
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
                        <span className="ml-1 mt-2 inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          เรียบร้อยแล้ว
                        </span>
                      ) : null}
                    </div>
                    <ChevronRight className="mt-1 h-5 w-5 text-slate-400 dark:text-slate-500" />
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-slate-500 dark:text-slate-400">ยอดบิล</p>
                      <p className="font-bold text-slate-950 dark:text-slate-100">{money(order.netAmount)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 dark:text-slate-400">ต้องชำระ</p>
                      <p className={remain > 0 ? "font-bold text-rose-700 dark:text-rose-400" : "font-bold text-emerald-700 dark:text-emerald-400"}>
                        {money(remain)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500 dark:text-slate-400">สินค้า</p>
                      <p className="font-bold text-slate-950 dark:text-slate-100">{order._count.items}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800">
                    <span className="font-semibold text-slate-600 dark:text-slate-300">
                      {remain > 0 ? "ดูรายละเอียดและช่องทางชำระ" : "เปิดเอกสารหรือดูรายการสินค้า"}
                    </span>
                    <span className="font-bold text-blue-800 dark:text-sky-400">ดูบิล</span>
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
