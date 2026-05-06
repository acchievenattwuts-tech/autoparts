import Link from "next/link";
import { BadgeDollarSign, ChevronRight, ReceiptText } from "lucide-react";

import LiffBottomNav from "@/components/liff/LiffBottomNav";
import { db } from "@/lib/db";
import { requireLiffCustomer } from "@/lib/liff-data";
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
      shippingStatus: true,
      _count: { select: { items: true, receipts: true } },
    },
    orderBy: { saleDate: "desc" },
    take: 50,
  });

  const outstandingCount = orders.filter((order) => Number(order.amountRemain ?? 0) > 0).length;

  return (
    <main className="min-h-dvh bg-gradient-to-b from-white via-sky-50 to-white pb-24">
      <section className="overflow-hidden rounded-b-[28px] border-b border-blue-100 bg-gradient-to-br from-white via-sky-50 to-blue-100 px-5 pb-6 pt-6 text-[#083a78] shadow-sm">
        <p className="text-sm font-semibold text-blue-700">บัญชีลูกค้า</p>
        <h1 className="mt-1 font-kanit text-2xl font-bold">{customer.name}</h1>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Link href="/liff/orders" className="rounded-2xl border border-blue-100 bg-white/90 px-3 py-3 shadow-sm">
            <ReceiptText className="mb-2 h-5 w-5 text-blue-700" />
            <p className="text-[11px] font-semibold text-slate-500">บิลทั้งหมด</p>
            <p className="font-kanit text-xl font-bold text-blue-950">{orders.length}</p>
          </Link>
          <Link href="/liff/outstanding" className="rounded-2xl border border-blue-100 bg-white/90 px-3 py-3 shadow-sm">
            <BadgeDollarSign className="mb-2 h-5 w-5 text-blue-700" />
            <p className="text-[11px] font-semibold text-slate-500">ค้างชำระ</p>
            <p className="font-kanit text-xl font-bold text-blue-950">{outstandingCount}</p>
          </Link>
        </div>
      </section>

      <section className="px-5 py-5">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="font-kanit text-xl font-bold text-slate-950">ประวัติคำสั่งซื้อ</h2>
            <p className="text-xs text-slate-500">แสดงล่าสุดไม่เกิน 50 รายการ</p>
          </div>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-800">
            {orders.length} บิล
          </span>
        </div>

        <div className="space-y-3">
          {orders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-blue-200 bg-white px-4 py-10 text-center text-sm text-slate-500 shadow-sm">
              ยังไม่มีประวัติคำสั่งซื้อ
            </div>
          ) : (
            orders.map((order) => {
              const remain = Number(order.amountRemain ?? 0);
              return (
                <Link
                  key={order.id}
                  href={`/liff/orders/${order.id}`}
                  className="block rounded-2xl border border-blue-100 bg-white p-4 shadow-sm transition active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm font-bold text-slate-950">{order.saleNo}</p>
                      <p className="mt-1 text-xs text-slate-500">{formatDateThai(order.saleDate)}</p>
                    </div>
                    <ChevronRight className="mt-1 h-5 w-5 text-slate-400" />
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-slate-500">ยอดรวม</p>
                      <p className="font-bold text-slate-950">{money(order.netAmount)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">คงค้าง</p>
                      <p className={remain > 0 ? "font-bold text-rose-700" : "font-bold text-emerald-700"}>
                        {money(remain)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">รายการ</p>
                      <p className="font-bold text-slate-950">{order._count.items}</p>
                    </div>
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
