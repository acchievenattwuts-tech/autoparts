import Link from "next/link";
import { ChevronRight } from "lucide-react";

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

  return (
    <main className="min-h-dvh pb-24">
      <section className="bg-slate-950 px-5 pb-6 pt-6 text-white">
        <p className="text-sm text-teal-100">บัญชีลูกค้า</p>
        <h1 className="mt-1 font-kanit text-2xl font-bold">{customer.name}</h1>
      </section>

      <section className="px-5 py-5">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="font-kanit text-xl font-bold text-slate-950">ประวัติคำสั่งซื้อ</h2>
            <p className="text-xs text-slate-500">แสดงล่าสุดไม่เกิน 50 รายการ</p>
          </div>
          <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-teal-800">
            {orders.length} บิล
          </span>
        </div>

        <div className="space-y-3">
          {orders.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
              ยังไม่มีประวัติคำสั่งซื้อ
            </div>
          ) : (
            orders.map((order) => {
              const remain = Number(order.amountRemain ?? 0);
              return (
                <Link
                  key={order.id}
                  href={`/liff/orders/${order.id}`}
                  className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition active:scale-[0.99]"
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
