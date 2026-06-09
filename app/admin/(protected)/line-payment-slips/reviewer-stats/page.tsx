export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, Info, Users } from "lucide-react";

import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import { getPaymentSlipReviewerStats } from "@/lib/line-payment-slip-reviewer-stats";
import { requirePermission } from "@/lib/require-auth";
import { getThailandDateKey, getThailandMonthStartDateKey, isDateOnlyString } from "@/lib/th-date";

type PageProps = {
  searchParams: Promise<{ from?: string; to?: string }>;
};

const inputClass =
  "h-10 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100";

/** Human-readable average review duration. */
function formatDuration(minutes: number | null): string {
  if (minutes === null) return "-";
  if (minutes < 1) return "< 1 นาที";
  if (minutes < 60) return `${Math.round(minutes)} นาที`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours < 24) return mins > 0 ? `${hours} ชม ${mins} นาที` : `${hours} ชม`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days} วัน ${remHours} ชม` : `${days} วัน`;
}

export default async function PaymentSlipReviewerStatsPage({ searchParams }: PageProps) {
  await requirePermission("line_payment_slips.view");
  const params = await searchParams;

  const from = isDateOnlyString(params.from) ? params.from : getThailandMonthStartDateKey();
  const to = isDateOnlyString(params.to) ? params.to : getThailandDateKey();

  const report = await getPaymentSlipReviewerStats({ from, to });

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
            <Users size={21} />
          </div>
          <div>
            <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
              สถิติการตรวจสลิป
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              จำนวนสลิปที่แต่ละแอดมินตรวจ ผลการตรวจ และเวลาเฉลี่ยตั้งแต่รับสลิปจนตรวจเสร็จ
            </p>
          </div>
        </div>

        <AdminSearchForm
          action="/admin/line-payment-slips/reviewer-stats"
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-slate-950/70">
          <p className="text-xs text-gray-500 dark:text-slate-400">ตรวจทั้งหมด</p>
          <p className="font-kanit text-xl font-bold text-gray-900 dark:text-slate-100">
            {report.totals.total.toLocaleString("th-TH")}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-slate-950/70">
          <p className="text-xs text-gray-500 dark:text-slate-400">ยืนยันแล้ว</p>
          <p className="font-kanit text-xl font-bold text-emerald-600 dark:text-emerald-300">
            {report.totals.confirmed.toLocaleString("th-TH")}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-slate-950/70">
          <p className="text-xs text-gray-500 dark:text-slate-400">ปฏิเสธ</p>
          <p className="font-kanit text-xl font-bold text-red-600 dark:text-red-300">
            {report.totals.rejected.toLocaleString("th-TH")}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-slate-950/70">
          <p className="text-xs text-gray-500 dark:text-slate-400">ขอข้อมูลเพิ่ม</p>
          <p className="font-kanit text-xl font-bold text-gray-700 dark:text-slate-200">
            {report.totals.needsMoreInfo.toLocaleString("th-TH")}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-200">
        <Info size={16} className="mt-0.5 shrink-0" />
        <p>
          เวลาเฉลี่ยนับจาก <span className="font-semibold">เวลาที่ระบบรับสลิป</span> จนถึง
          <span className="font-semibold"> เวลาที่แอดมินตรวจเสร็จ</span> — สะท้อนความเร็วในการตอบลูกค้า
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-slate-950/70">
        {report.rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-gray-500 dark:text-slate-400">
            ไม่พบการตรวจสลิปในช่วงวันที่ที่เลือก
          </div>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500 dark:border-white/10 dark:text-slate-400">
                <th className="px-4 py-3 font-medium">แอดมิน</th>
                <th className="px-4 py-3 text-right font-medium">ตรวจทั้งหมด</th>
                <th className="px-4 py-3 text-right font-medium">ยืนยัน</th>
                <th className="px-4 py-3 text-right font-medium">ปฏิเสธ</th>
                <th className="px-4 py-3 text-right font-medium">ขอข้อมูลเพิ่ม</th>
                <th className="px-4 py-3 text-right font-medium">เวลาเฉลี่ย</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {report.rows.map((row) => (
                <tr key={row.reviewerId} className="text-gray-900 dark:text-slate-100">
                  <td className="px-4 py-3 font-medium">{row.reviewerName}</td>
                  <td className="px-4 py-3 text-right">{row.total.toLocaleString("th-TH")}</td>
                  <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-300">
                    {row.confirmed.toLocaleString("th-TH")}
                  </td>
                  <td className="px-4 py-3 text-right text-red-600 dark:text-red-300">
                    {row.rejected.toLocaleString("th-TH")}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500 dark:text-slate-400">
                    {row.needsMoreInfo.toLocaleString("th-TH")}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-200">
                    {formatDuration(row.avgReviewMinutes)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 font-semibold text-gray-900 dark:border-white/10 dark:text-slate-100">
                <td className="px-4 py-3">รวม</td>
                <td className="px-4 py-3 text-right">{report.totals.total.toLocaleString("th-TH")}</td>
                <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-300">
                  {report.totals.confirmed.toLocaleString("th-TH")}
                </td>
                <td className="px-4 py-3 text-right text-red-600 dark:text-red-300">
                  {report.totals.rejected.toLocaleString("th-TH")}
                </td>
                <td className="px-4 py-3 text-right text-gray-500 dark:text-slate-400">
                  {report.totals.needsMoreInfo.toLocaleString("th-TH")}
                </td>
                <td className="px-4 py-3 text-right text-gray-400 dark:text-slate-500">—</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
