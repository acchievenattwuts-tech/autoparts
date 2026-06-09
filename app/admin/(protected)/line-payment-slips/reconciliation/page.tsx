export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, Info, Scale } from "lucide-react";

import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import { getPaymentReconciliation } from "@/lib/line-payment-slip-reconciliation";
import { requirePermission } from "@/lib/require-auth";
import { formatDateThai, getThailandDateKey, getThailandMonthStartDateKey, isDateOnlyString } from "@/lib/th-date";

type PageProps = {
  searchParams: Promise<{ from?: string; to?: string }>;
};

function formatBaht(amount: number): string {
  return amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Variance cell colour: ~0 = balanced (green), otherwise amber to flag a gap. */
function varianceClass(variance: number): string {
  if (Math.abs(variance) < 0.005) {
    return "text-emerald-600 dark:text-emerald-300";
  }
  return "text-amber-600 dark:text-amber-300";
}

const inputClass =
  "h-10 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100";

export default async function PaymentReconciliationPage({ searchParams }: PageProps) {
  await requirePermission("line_payment_slips.view");
  const params = await searchParams;

  // Reports default to the current month (you reconcile a period); the user can change it.
  const from = isDateOnlyString(params.from) ? params.from : getThailandMonthStartDateKey();
  const to = isDateOnlyString(params.to) ? params.to : getThailandDateKey();

  const report = await getPaymentReconciliation({ from, to });

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/admin/line-payment-slips"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-100"
        >
          <ArrowLeft size={16} /> กลับไปรายการสลิป
        </Link>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#1e3a5f]/10 text-[#1e3a5f] dark:bg-sky-500/10 dark:text-sky-200">
            <Scale size={21} />
          </div>
          <div>
            <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
              กระทบยอดเงินโอน
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              เทียบยอดสลิปที่ยืนยันแล้ว กับใบเสร็จรับเงินแบบโอน (รายวัน)
            </p>
          </div>
        </div>

        <AdminSearchForm
          action="/admin/line-payment-slips/reconciliation"
          className="flex flex-wrap items-end gap-2 space-y-0"
        >
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
            จากวันที่
            <input type="date" name="from" defaultValue={from} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
            ถึงวันที่
            <input type="date" name="to" defaultValue={to} className={inputClass} />
          </label>
          <AdminSearchSubmitButton className="h-10 rounded-md">แสดงรายงาน</AdminSearchSubmitButton>
        </AdminSearchForm>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-slate-950/70">
          <p className="text-xs text-gray-500 dark:text-slate-400">สลิปยืนยันแล้ว</p>
          <p className="font-kanit text-xl font-bold text-gray-900 dark:text-slate-100">
            ฿{formatBaht(report.totals.slipAmount)}
          </p>
          <p className="text-xs text-gray-400 dark:text-slate-500">
            {report.totals.slipCount.toLocaleString("th-TH")} รายการ
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-slate-950/70">
          <p className="text-xs text-gray-500 dark:text-slate-400">ใบเสร็จเงินโอน</p>
          <p className="font-kanit text-xl font-bold text-gray-900 dark:text-slate-100">
            ฿{formatBaht(report.totals.receiptAmount)}
          </p>
          <p className="text-xs text-gray-400 dark:text-slate-500">
            {report.totals.receiptCount.toLocaleString("th-TH")} รายการ
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-slate-950/70">
          <p className="text-xs text-gray-500 dark:text-slate-400">ส่วนต่าง (สลิป − ใบเสร็จ)</p>
          <p className={`font-kanit text-xl font-bold ${varianceClass(report.totals.variance)}`}>
            ฿{formatBaht(report.totals.variance)}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
        <Info size={16} className="mt-0.5 shrink-0" />
        <p>
          เป็นการเทียบ <span className="font-semibold">ยอดรวมรายวัน</span> ไม่ใช่จับคู่ทีละรายการ — สลิปนับเฉพาะที่
          <span className="font-semibold"> ยืนยันแล้ว</span> ส่วนใบเสร็จนับเฉพาะ <span className="font-semibold">วิธีชำระแบบโอน สถานะใช้งาน</span>.
          ส่วนต่างบวก = มีสลิปที่ยังไม่ได้ออกใบเสร็จ, ส่วนต่างลบ = มีใบเสร็จเงินโอนที่ไม่มีสลิปใน LINE
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-slate-950/70">
        {report.rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-gray-500 dark:text-slate-400">
            ไม่พบข้อมูลในช่วงวันที่ที่เลือก
          </div>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500 dark:border-white/10 dark:text-slate-400">
                <th className="px-4 py-3 font-medium">วันที่</th>
                <th className="px-4 py-3 text-right font-medium">สลิป (รายการ)</th>
                <th className="px-4 py-3 text-right font-medium">ยอดสลิป</th>
                <th className="px-4 py-3 text-right font-medium">ใบเสร็จ (รายการ)</th>
                <th className="px-4 py-3 text-right font-medium">ยอดใบเสร็จ</th>
                <th className="px-4 py-3 text-right font-medium">ส่วนต่าง</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {report.rows.map((row) => (
                <tr key={row.dateKey} className="text-gray-900 dark:text-slate-100">
                  <td className="px-4 py-3">{formatDateThai(`${row.dateKey}T00:00:00+07:00`, { dateStyle: "medium" })}</td>
                  <td className="px-4 py-3 text-right text-gray-500 dark:text-slate-400">
                    {row.slipCount.toLocaleString("th-TH")}
                  </td>
                  <td className="px-4 py-3 text-right font-kanit">฿{formatBaht(row.slipAmount)}</td>
                  <td className="px-4 py-3 text-right text-gray-500 dark:text-slate-400">
                    {row.receiptCount.toLocaleString("th-TH")}
                  </td>
                  <td className="px-4 py-3 text-right font-kanit">฿{formatBaht(row.receiptAmount)}</td>
                  <td className={`px-4 py-3 text-right font-kanit font-semibold ${varianceClass(row.variance)}`}>
                    ฿{formatBaht(row.variance)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 font-semibold text-gray-900 dark:border-white/10 dark:text-slate-100">
                <td className="px-4 py-3">รวม</td>
                <td className="px-4 py-3 text-right text-gray-500 dark:text-slate-400">
                  {report.totals.slipCount.toLocaleString("th-TH")}
                </td>
                <td className="px-4 py-3 text-right font-kanit">฿{formatBaht(report.totals.slipAmount)}</td>
                <td className="px-4 py-3 text-right text-gray-500 dark:text-slate-400">
                  {report.totals.receiptCount.toLocaleString("th-TH")}
                </td>
                <td className="px-4 py-3 text-right font-kanit">฿{formatBaht(report.totals.receiptAmount)}</td>
                <td className={`px-4 py-3 text-right font-kanit ${varianceClass(report.totals.variance)}`}>
                  ฿{formatBaht(report.totals.variance)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
