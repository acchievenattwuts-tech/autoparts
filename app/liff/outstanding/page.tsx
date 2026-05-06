import Link from "next/link";
import { AlertCircle, CheckCircle2, ChevronRight, Landmark } from "lucide-react";

import CopyPaymentValueButton from "@/components/liff/CopyPaymentValueButton";
import LiffBottomNav from "@/components/liff/LiffBottomNav";
import { db } from "@/lib/db";
import { addDays, formatLiffMoney, isBeforeToday } from "@/lib/liff-format";
import { requireLiffCustomer } from "@/lib/liff-data";
import { getPrimaryTransferAccount } from "@/lib/payment-qr";
import { formatDateThai } from "@/lib/th-date";

export default async function LiffOutstandingPage() {
  const customer = await requireLiffCustomer();
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
    <main className="min-h-dvh bg-gradient-to-b from-white via-sky-50 to-white pb-24">
      <section className="overflow-hidden rounded-b-[28px] border-b border-blue-100 bg-gradient-to-br from-white via-sky-50 to-blue-100 px-5 pb-6 pt-6 text-[#083a78] shadow-sm">
        <p className="text-sm font-semibold text-blue-700">ยอดค้างชำระ</p>
        <h1 className="mt-1 font-kanit text-2xl font-bold">{customer.name}</h1>
        <div className="mt-5 rounded-2xl border border-blue-100 bg-white/90 px-4 py-5 text-slate-950 shadow-sm">
          <p className="text-sm text-slate-500">ยอดค้างทั้งหมด</p>
          <p className="mt-1 font-kanit text-3xl font-bold">{formatLiffMoney(totalOutstanding)} บาท</p>
          <p className="mt-2 text-sm text-slate-600">
            {rows.length} บิล{overdueCount > 0 ? ` · เกินกำหนด ${overdueCount} บิล` : ""}
          </p>
        </div>
      </section>

      <section className="space-y-4 px-5 py-5">
        <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Landmark className="h-5 w-5 text-blue-700" />
            <h2 className="font-kanit text-lg font-bold text-slate-950">ช่องทางรับชำระเงิน</h2>
          </div>
          {transferAccount ? (
            <div className="space-y-2 text-sm">
              <p className="font-semibold text-slate-900">{transferAccount.bankName ?? transferAccount.name}</p>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-blue-50/60 px-3 py-2">
                <p className="text-slate-600">เลขบัญชี {transferAccount.accountNo ?? "-"}</p>
                {transferAccount.accountNo ? (
                  <CopyPaymentValueButton label="คัดลอกเลขบัญชี" value={transferAccount.accountNo} />
                ) : null}
              </div>
              <p className="text-slate-600">ชื่อบัญชี {transferAccount.name}</p>
              {transferAccount.promptPayId ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-blue-50/60 px-3 py-2">
                  <p className="text-slate-600">PromptPay {transferAccount.promptPayId}</p>
                  <CopyPaymentValueButton label="คัดลอก PromptPay" value={transferAccount.promptPayId} />
                </div>
              ) : null}
              <p className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">
                หลังโอนเงินกรุณาส่งสลิปในแชท LINE OA นี้ได้เลยค่ะ
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">กรุณาติดต่อร้านเพื่อรับช่องทางชำระเงิน</p>
          )}
        </div>

        <div className="space-y-3">
          {rows.length === 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-8 text-center text-emerald-800 shadow-sm">
              <CheckCircle2 className="mx-auto mb-2 h-7 w-7" />
              <p className="font-semibold">ขณะนี้ไม่มีบิลค้างชำระ ขอบคุณค่ะ</p>
            </div>
          ) : (
            rows.map((sale) => (
              <Link
                key={sale.id}
                href={`/liff/orders/${sale.id}`}
                className="block rounded-2xl border border-blue-100 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      {sale.overdue ? (
                        <AlertCircle className="h-4 w-4 text-rose-700" />
                      ) : null}
                      <p className="font-mono text-sm font-bold text-slate-950">{sale.saleNo}</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">วันที่ขาย {formatDateThai(sale.saleDate)}</p>
                    <p className={sale.overdue ? "mt-1 text-xs font-semibold text-rose-700" : "mt-1 text-xs text-slate-500"}>
                      ครบกำหนด {formatDateThai(sale.dueDate)}
                    </p>
                  </div>
                  <ChevronRight className="mt-1 h-5 w-5 text-slate-400" />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-slate-500">ยอดบิล</p>
                    <p className="font-bold text-slate-950">{formatLiffMoney(sale.netAmount)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">ชำระแล้ว</p>
                    <p className="font-bold text-slate-950">{formatLiffMoney(sale.paidAmount)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">คงค้าง</p>
                    <p className={sale.overdue ? "font-bold text-rose-700" : "font-bold text-amber-700"}>
                      {formatLiffMoney(sale.amountRemain)}
                    </p>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </section>
      <LiffBottomNav active="/liff/outstanding" />
    </main>
  );
}
