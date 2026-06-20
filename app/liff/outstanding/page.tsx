import Link from "next/link";
import { AlertCircle, CheckCircle2, ChevronRight, Landmark, Store, Truck } from "lucide-react";

import CopyPaymentValueButton from "@/components/liff/CopyPaymentValueButton";
import LiffLinkRequired from "@/components/liff/LiffLinkRequired";
import { db } from "@/lib/db";
import { addDays, formatLiffMoney, isBeforeToday } from "@/lib/liff-format";
import { getLiffCustomer } from "@/lib/liff-data";
import { getPrimaryTransferAccount } from "@/lib/payment-qr";
import { SHIPPING_STATUS_BADGE, SHIPPING_STATUS_LABEL } from "@/lib/shipping";
import { formatDateThai } from "@/lib/th-date";

export default async function LiffOutstandingPage() {
  const customer = await getLiffCustomer();
  if (!customer) {
    return (
      <LiffLinkRequired
        title="ผูกเบอร์เพื่อดูยอดค้างชำระ"
        description="กรุณาผูกบัญชี LINE กับเบอร์โทรที่ลงทะเบียนไว้กับร้าน เพื่อตรวจสอบยอดและช่องทางชำระเงิน"
      />
    );
  }
  const [sales, transferAccount] = await Promise.all([
    db.sale.findMany({
      where: {
        customerId: customer.id,
        status: "ACTIVE",
        paymentType: "CREDIT_SALE",
        amountRemain: { gt: 0 },
      },
      select: {
        id: true,
        saleNo: true,
        saleDate: true,
        netAmount: true,
        amountRemain: true,
        creditTerm: true,
        fulfillmentType: true,
        shippingStatus: true,
      },
      orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }],
      take: 50,
    }),
    getPrimaryTransferAccount(),
  ]);

  const rows = sales
    .map((sale) => {
      const dueDate = addDays(sale.saleDate, sale.creditTerm ?? customer.creditTerm ?? 0);
      return {
        ...sale,
        dueDate,
        paidAmount: Number(sale.netAmount) - Number(sale.amountRemain),
        overdue: isBeforeToday(dueDate),
      };
    })
    .sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime());

  const totalOutstanding = rows.reduce((sum, sale) => sum + Number(sale.amountRemain), 0);
  const overdueCount = rows.filter((sale) => sale.overdue).length;

  return (
    <main className="min-h-dvh bg-gradient-to-b from-white via-sky-50 to-white pb-24 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <section className="overflow-hidden rounded-b-[32px] border-b border-blue-100 bg-gradient-to-br from-white via-sky-50 to-emerald-50 px-5 pb-6 pt-6 text-[#083a78] shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 dark:text-sky-200">
        <p className="text-sm font-semibold text-blue-700 dark:text-sky-400">ชำระเงิน</p>
        <h1 className="mt-1 font-kanit text-2xl font-bold dark:text-slate-100">{customer.name}</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          {rows.length > 0 ? "ตรวจยอดและเลือกบิลที่ต้องการดูรายละเอียดได้เลย" : "ตอนนี้บัญชีของคุณเรียบร้อยดี"}
        </p>
        <div className="mt-5 rounded-[24px] border border-blue-100 bg-white/90 px-4 py-5 text-slate-950 shadow-sm dark:border-slate-700 dark:bg-slate-800/90 dark:text-slate-100">
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">ยอดที่ต้องชำระ</p>
          <p className="mt-1 font-kanit text-4xl font-extrabold text-[#06152d] drop-shadow-sm dark:text-slate-100">
            {formatLiffMoney(totalOutstanding)} บาท
          </p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {rows.length} บิล{overdueCount > 0 ? ` · ควรชำระด่วน ${overdueCount} บิล` : ""}
          </p>
        </div>
      </section>

      <section className="space-y-4 px-5 py-5">
        <div className="rounded-[24px] border border-blue-100 bg-white p-4 shadow-sm shadow-blue-950/5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center gap-2">
            <Landmark className="h-5 w-5 text-blue-700 dark:text-sky-400" />
            <h2 className="font-kanit text-lg font-bold text-slate-950 dark:text-slate-100">ช่องทางชำระเงิน</h2>
          </div>
          {transferAccount ? (
            <div className="space-y-2 text-sm">
              <p className="font-semibold text-slate-900 dark:text-slate-200">{transferAccount.bankName ?? transferAccount.name}</p>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-blue-50/60 px-3 py-2 dark:bg-slate-800/60">
                <div className="space-y-0.5">
                  <p className="text-slate-600 dark:text-slate-300">เลขบัญชี {transferAccount.accountNo ?? "-"}</p>
                  <p className="text-slate-600 dark:text-slate-300">ชื่อบัญชี {transferAccount.name}</p>
                </div>
                {transferAccount.accountNo ? (
                  <CopyPaymentValueButton label="คัดลอกเลขบัญชี" value={transferAccount.accountNo} />
                ) : null}
              </div>
              {transferAccount.promptPayId ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-blue-50/60 px-3 py-2 dark:bg-slate-800/60">
                  <p className="text-slate-600 dark:text-slate-300">PromptPay {transferAccount.promptPayId}</p>
                  <CopyPaymentValueButton label="คัดลอก PromptPay" value={transferAccount.promptPayId} />
                </div>
              ) : null}
              <p className="rounded-2xl bg-[#e9f8f0] px-3 py-2 text-xs font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                หลังโอนแล้ว ส่งสลิปในแชท LINE OA นี้ได้เลยค่ะ
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">กรุณาติดต่อร้านเพื่อรับช่องทางชำระเงิน</p>
          )}
        </div>

        <div className="space-y-3">
          {rows.length === 0 ? (
            <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 px-4 py-8 text-center text-emerald-800 shadow-sm dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              <CheckCircle2 className="mx-auto mb-2 h-7 w-7" />
              <p className="font-semibold">ไม่มีบิลที่ต้องชำระ ขอบคุณค่ะ</p>
            </div>
          ) : (
            rows.map((sale) => {
              const isPickup = sale.fulfillmentType === "PICKUP";

              return (
                <Link
                  key={sale.id}
                  href={`/liff/orders/${sale.id}`}
                  className="block rounded-[24px] border border-blue-100 bg-white p-4 shadow-sm shadow-blue-950/5 transition active:scale-[0.99] dark:border-slate-700 dark:bg-slate-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                    <div className="flex items-center gap-2">
                      {sale.overdue ? (
                        <AlertCircle className="h-4 w-4 text-rose-700 dark:text-rose-400" />
                      ) : null}
                      <p className="font-mono text-sm font-bold text-slate-950 dark:text-slate-100">{sale.saleNo}</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">วันที่ขาย {formatDateThai(sale.saleDate)}</p>
                    <p className={sale.overdue ? "mt-1 text-xs font-semibold text-rose-700 dark:text-rose-400" : "mt-1 text-xs text-slate-500 dark:text-slate-400"}>
                      ควรชำระภายใน {formatDateThai(sale.dueDate)}
                    </p>
                      {isPickup ? (
                        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-bold text-violet-800 dark:bg-violet-950 dark:text-violet-300">
                          <Store size={12} />
                          รับหน้าร้าน
                        </span>
                      ) : (
                        <span className={`mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${SHIPPING_STATUS_BADGE[sale.shippingStatus] ?? "bg-slate-100 text-slate-700"}`}>
                          <Truck size={12} />
                          {SHIPPING_STATUS_LABEL[sale.shippingStatus] ?? sale.shippingStatus}
                        </span>
                      )}
                    </div>
                    <ChevronRight className="mt-1 h-5 w-5 text-slate-400 dark:text-slate-500" />
                  </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">ยอดบิล</p>
                    <p className="font-bold text-slate-950 dark:text-slate-100">{formatLiffMoney(sale.netAmount)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">ชำระแล้ว</p>
                    <p className="font-bold text-slate-950 dark:text-slate-100">{formatLiffMoney(sale.paidAmount)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">ต้องชำระ</p>
                    <p className={sale.overdue ? "font-bold text-rose-700 dark:text-rose-400" : "font-bold text-amber-700 dark:text-amber-400"}>
                      {formatLiffMoney(sale.amountRemain)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">
                    {sale.overdue ? "บิลนี้ควรชำระด่วน" : "เปิดบิลเพื่อดูรายละเอียด"}
                  </span>
                  <span className="font-bold text-blue-800 dark:text-sky-400">ดูบิล</span>
                </div>
                </Link>
              );
            })
          )}
        </div>
      </section>
    </main>
  );
}
