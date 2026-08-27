export const dynamic = "force-dynamic";

import { TriangleAlert } from "lucide-react";
import { requirePermission } from "@/lib/require-auth";
import {
  getThailandDateKey,
  formatDateThai,
  parseDateOnlyToEndOfDay,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";
import {
  getMarketplaceChannelConfig,
  MANUAL_MARKETPLACE_CHANNELS,
} from "@/lib/marketplace/config";
import {
  estimatePendingChannelFees,
  getChannelCashHealth,
  getChannelFeeBreakdown,
  getChannelProductProfit,
  getChannelReturnRate,
  getMarketplaceChannelSetting,
  getMarketplaceProfitOverview,
} from "@/lib/marketplace/queries";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";

const money = (value: number) =>
  value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (value: number) => `${value.toFixed(1)}%`;

function firstDayOfMonth(dateKey: string) {
  return `${dateKey.slice(0, 7)}-01`;
}

const cardCls =
  "rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#101b2e]";
const sectionCls = `${cardCls} space-y-4`;
const thCls = "p-2 text-left font-medium";
const tdNumCls = "p-2 text-right tabular-nums";

export default async function MarketplaceReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requirePermission("reports.view");
  const params = await searchParams;
  const today = getThailandDateKey();
  const from = params.from ?? firstDayOfMonth(today);
  const to = params.to ?? today;
  const start = parseDateOnlyToStartOfDay(from);
  const end = parseDateOnlyToEndOfDay(to);

  const channels = [...MANUAL_MARKETPLACE_CHANNELS];
  const [overview, pendingFees, feeBreakdown, settings] = await Promise.all([
    getMarketplaceProfitOverview(start, end),
    estimatePendingChannelFees(start, end),
    getChannelFeeBreakdown(channels, start, end),
    Promise.all(channels.map((channel) => getMarketplaceChannelSetting(channel))),
  ]);

  const [products, channelStats] = await Promise.all([
    getChannelProductProfit(channels, start, end, pendingFees.averageFeeRate),
    Promise.all(
      channels.map(async (channel, index) => {
        const setting = settings[index];
        const [returnRate, cashHealth] = await Promise.all([
          getChannelReturnRate(channel, start, end),
          setting
            ? getChannelCashHealth(channel, setting.settlementCashBankAccountId)
            : Promise.resolve(null),
        ]);
        return { channel, config: getMarketplaceChannelConfig(channel), returnRate, cashHealth };
      }),
    ),
  ]);

  const marketplaceRows = overview.rows.filter((row) => row.channel !== "STORE");
  const marketplaceSales = marketplaceRows.reduce((sum, row) => sum + row.salesAmount, 0);
  const marketplaceGross = marketplaceRows.reduce((sum, row) => sum + row.grossProfit, 0);
  const marketplaceFees = marketplaceRows.reduce((sum, row) => sum + row.feeAmount, 0);
  const marketplaceContribution = marketplaceRows.reduce((sum, row) => sum + row.contribution, 0);
  const totals = overview.rows.reduce(
    (acc, row) => ({
      salesAmount: acc.salesAmount + row.salesAmount,
      costAmount: acc.costAmount + row.costAmount,
      grossProfit: acc.grossProfit + row.grossProfit,
      feeAmount: acc.feeAmount + row.feeAmount,
      contribution: acc.contribution + row.contribution,
    }),
    { salesAmount: 0, costAmount: 0, grossProfit: 0, feeAmount: 0, contribution: 0 },
  );

  const summaryCards: Array<{ label: string; value: string; detail: string; tone?: string }> = [
    {
      label: "ยอดขายช่องทางออนไลน์",
      value: money(marketplaceSales),
      detail: "หักยอดคืนสินค้าแล้ว",
    },
    {
      label: "กำไรขั้นต้น",
      value: money(marketplaceGross),
      detail: marketplaceSales > 0 ? `อัตรากำไร ${percent((marketplaceGross / marketplaceSales) * 100)}` : "—",
    },
    {
      label: "ค่าธรรมเนียมแพลตฟอร์ม",
      value: money(marketplaceFees),
      detail:
        marketplaceSales > 0
          ? `คิดเป็น ${percent((marketplaceFees / marketplaceSales) * 100)} ของยอดขาย`
          : "—",
      tone: "text-rose-600 dark:text-rose-300",
    },
    {
      label: "เหลือจริงหลังค่าธรรมเนียม",
      value: money(marketplaceContribution),
      detail: "ยังไม่หักค่าใช้จ่ายส่วนกลางของร้าน",
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="รายงานผู้บริหาร"
        title="ช่องทางขายออนไลน์"
        description="เทียบผลประกอบการหน้าร้านกับแพลตฟอร์มออนไลน์จากชุดข้อมูลกำไรเดียวกับรายงานกำไรหลัก — ค่าธรรมเนียมถูกรับรู้ที่วันขายของแต่ละออเดอร์ ไม่ใช่วันที่แพลตฟอร์มโอนเงิน"
      />

      <AdminSearchForm
        action="/admin/reports/marketplace"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#101b2e]"
      >
        <label className="text-sm text-slate-600 dark:text-slate-300">
          จาก
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 dark:border-white/20 dark:bg-slate-900"
          />
        </label>
        <label className="text-sm text-slate-600 dark:text-slate-300">
          ถึง
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 dark:border-white/20 dark:bg-slate-900"
          />
        </label>
        <AdminSearchSubmitButton>แสดงรายงาน</AdminSearchSubmitButton>
      </AdminSearchForm>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <div key={card.label} className={cardCls}>
            <p className="text-sm text-slate-500 dark:text-slate-400">{card.label}</p>
            <p
              className={`mt-2 text-2xl font-bold tabular-nums ${card.tone ?? "text-slate-900 dark:text-slate-100"}`}
            >
              ฿{card.value}
            </p>
            <p className="mt-1 text-xs text-slate-400">{card.detail}</p>
          </div>
        ))}
      </div>

      {pendingFees.pendingSalesAmount > 0 ? (
        <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-400/30 dark:bg-amber-500/10">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-amber-900 dark:text-amber-100">
              กำไรของช่วงนี้ยังจะถูกปรับลดอีกประมาณ ฿{money(pendingFees.estimatedPendingFee)}
            </p>
            <p className="text-amber-800 dark:text-amber-200">
              มียอดขาย ฿{money(pendingFees.pendingSalesAmount)} ที่แพลตฟอร์มยังไม่โอน
              ค่าธรรมเนียมของก้อนนี้จะถูกบันทึกย้อนกลับมาที่วันขายเมื่อกระทบยอดรอบถัดไป
              {pendingFees.sampleSettlementCount > 0
                ? ` (ประมาณจากอัตราค่าธรรมเนียมเฉลี่ย ${percent(pendingFees.averageFeeRate * 100)} จาก ${pendingFees.sampleSettlementCount} รอบที่ผ่านมา)`
                : " (ยังไม่มีรอบรับเงินให้ใช้ประมาณอัตราค่าธรรมเนียม)"}
            </p>
            <p className="text-amber-800 dark:text-amber-200">
              ควรกระทบยอดให้ครบก่อนปิดงวดหรือประกาศแบ่งกำไร
            </p>
          </div>
        </div>
      ) : null}

      <div className={sectionCls}>
        <h2 className="font-kanit text-lg font-semibold text-slate-900 dark:text-slate-100">
          เทียบผลประกอบการรายช่องทาง
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="border-b border-slate-200 text-slate-500 dark:border-white/10 dark:text-slate-300">
              <tr>
                <th className={thCls}>ช่องทาง</th>
                <th className="p-2 text-right font-medium">ยอดขายสุทธิ</th>
                <th className="p-2 text-right font-medium">ต้นทุนขาย</th>
                <th className="p-2 text-right font-medium">กำไรขั้นต้น</th>
                <th className="p-2 text-right font-medium">%GP</th>
                <th className="p-2 text-right font-medium">ค่าธรรมเนียม</th>
                <th className="p-2 text-right font-medium">รับเพิ่ม</th>
                <th className="p-2 text-right font-medium">เหลือจริง</th>
              </tr>
            </thead>
            <tbody>
              {overview.rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400">
                    ไม่มีข้อมูลในช่วงที่เลือก
                  </td>
                </tr>
              ) : (
                overview.rows.map((row) => (
                  <tr key={row.channel} className="border-t border-slate-100 dark:border-white/5">
                    <td className="p-2 font-medium">{row.label}</td>
                    <td className={tdNumCls}>{money(row.salesAmount)}</td>
                    <td className={tdNumCls}>{money(row.costAmount)}</td>
                    <td className={tdNumCls}>{money(row.grossProfit)}</td>
                    <td className={tdNumCls}>
                      {row.salesAmount > 0 ? percent((row.grossProfit / row.salesAmount) * 100) : "—"}
                    </td>
                    <td className={`${tdNumCls} text-rose-600 dark:text-rose-300`}>
                      {row.feeAmount > 0 ? `-${money(row.feeAmount)}` : "—"}
                    </td>
                    <td className={`${tdNumCls} text-emerald-600 dark:text-emerald-300`}>
                      {row.incomeAmount > 0 ? `+${money(row.incomeAmount)}` : "—"}
                    </td>
                    <td className={`${tdNumCls} font-semibold`}>{money(row.contribution)}</td>
                  </tr>
                ))
              )}
              <tr className="border-t-2 border-slate-300 font-semibold dark:border-white/20">
                <td className="p-2">รวมทุกช่องทาง</td>
                <td className={tdNumCls}>{money(totals.salesAmount)}</td>
                <td className={tdNumCls}>{money(totals.costAmount)}</td>
                <td className={tdNumCls}>{money(totals.grossProfit)}</td>
                <td className={tdNumCls}>
                  {totals.salesAmount > 0
                    ? percent((totals.grossProfit / totals.salesAmount) * 100)
                    : "—"}
                </td>
                <td className={`${tdNumCls} text-rose-600 dark:text-rose-300`}>
                  -{money(totals.feeAmount)}
                </td>
                <td className={tdNumCls} />
                <td className={tdNumCls}>{money(totals.contribution)}</td>
              </tr>
              <tr className="border-t border-slate-100 text-slate-600 dark:border-white/5 dark:text-slate-300">
                <td className="p-2" colSpan={7}>
                  ค่าใช้จ่ายส่วนกลางของร้าน (ไม่ปันเข้าช่องทาง)
                </td>
                <td className={`${tdNumCls} text-rose-600 dark:text-rose-300`}>
                  -{money(overview.sharedExpenseAmount)}
                </td>
              </tr>
              <tr className="border-t-2 border-slate-300 text-base font-bold dark:border-white/20">
                <td className="p-2" colSpan={7}>
                  กำไรสุทธิทั้งร้าน
                </td>
                <td className={tdNumCls}>{money(overview.totalNetProfit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          &ldquo;เหลือจริง&rdquo; คือกำไรขั้นต้นหลังหักค่าธรรมเนียมของช่องทางนั้น ยังไม่ใช่กำไรสุทธิ
          เพราะค่าไฟ เงินเดือน และค่าใช้จ่ายอื่นของร้านไม่ได้ผูกกับช่องทางใดช่องทางหนึ่ง
          จึงแสดงแยกบรรทัดแทนการปันส่วน
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={sectionCls}>
          <h2 className="font-kanit text-lg font-semibold text-slate-900 dark:text-slate-100">
            สินค้าที่ทำกำไรดีที่สุด
          </h2>
          <ProductTable rows={products.best} emptyLabel="ยังไม่มียอดขายออนไลน์ในช่วงนี้" />
        </div>
        <div className={sectionCls}>
          <h2 className="font-kanit text-lg font-semibold text-rose-700 dark:text-rose-300">
            สินค้าที่ขาดทุนหลังค่าธรรมเนียม
          </h2>
          <ProductTable
            rows={products.worst}
            emptyLabel="ไม่มีสินค้าที่ขาดทุนหลังค่าธรรมเนียมในช่วงนี้"
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            ประมาณโดยปันค่าธรรมเนียมด้วยอัตราเฉลี่ยของช่องทาง ใช้เพื่อจัดลำดับความเสี่ยง
            ไม่ใช่ตัวเลขทางบัญชีรายสินค้า — สินค้าที่ติดลบควรทบทวนราคาขายหรือถอดออกจากแพลตฟอร์ม
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={sectionCls}>
          <h2 className="font-kanit text-lg font-semibold text-slate-900 dark:text-slate-100">
            ค่าธรรมเนียมและรายการปรับปรุงแยกประเภท
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="text-slate-500 dark:text-slate-300">
                <tr>
                  <th className={thCls}>รหัส</th>
                  <th className={thCls}>รายละเอียด</th>
                  <th className="p-2 text-right font-medium">ยอดรวม</th>
                </tr>
              </thead>
              <tbody>
                {feeBreakdown.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="p-8 text-center text-slate-400">
                      ยังไม่มีรอบรับเงินในช่วงนี้
                    </td>
                  </tr>
                ) : (
                  feeBreakdown.map((row) => (
                    <tr
                      key={`${row.feeCode}-${row.label}`}
                      className="border-t border-slate-100 dark:border-white/5"
                    >
                      <td className="p-2 font-mono">{row.feeCode}</td>
                      <td className="p-2">{row.label}</td>
                      <td
                        className={`${tdNumCls} ${row.amount < 0 ? "text-rose-600 dark:text-rose-300" : "text-emerald-600 dark:text-emerald-300"}`}
                      >
                        {money(row.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className={sectionCls}>
          <h2 className="font-kanit text-lg font-semibold text-slate-900 dark:text-slate-100">
            สุขภาพของแต่ละช่องทาง
          </h2>
          <div className="space-y-4">
            {channelStats.map((stat) => (
              <div
                key={stat.channel}
                className="rounded-lg border border-slate-200 p-4 dark:border-white/10"
              >
                <p className="font-medium text-slate-900 dark:text-slate-100">{stat.config.label}</p>
                {stat.cashHealth ? (
                  <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500 dark:text-slate-400">ยังไม่ได้รับโอน</dt>
                      <dd className="tabular-nums">฿{money(stat.cashHealth.holdingBalance)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500 dark:text-slate-400">ออเดอร์ค้างรับเงิน</dt>
                      <dd className="tabular-nums">{stat.cashHealth.pendingSaleCount} ใบ</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500 dark:text-slate-400">ออเดอร์เก่าสุดที่ค้าง</dt>
                      <dd>
                        {stat.cashHealth.oldestPendingSaleDate
                          ? formatDateThai(stat.cashHealth.oldestPendingSaleDate)
                          : "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500 dark:text-slate-400">อัตราคืนสินค้า</dt>
                      <dd className="tabular-nums">
                        {percent(stat.returnRate.returnRatePct)} ({stat.returnRate.returnCount} ใบ)
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    ยังไม่ได้ตั้งค่าช่องทางนี้
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductTable({
  rows,
  emptyLabel,
}: {
  rows: Array<{
    productId: string | null;
    productName: string;
    salesAmount: number;
    grossProfit: number;
    estimatedProfitAfterFee: number;
  }>;
  emptyLabel: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead className="text-slate-500 dark:text-slate-300">
          <tr>
            <th className="p-2 text-left font-medium">สินค้า</th>
            <th className="p-2 text-right font-medium">ยอดขาย</th>
            <th className="p-2 text-right font-medium">กำไรขั้นต้น</th>
            <th className="p-2 text-right font-medium">หลังค่าธรรมเนียม</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="p-8 text-center text-slate-400">
                {emptyLabel}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.productId ?? row.productName}
                className="border-t border-slate-100 dark:border-white/5"
              >
                <td className="p-2">{row.productName}</td>
                <td className="p-2 text-right tabular-nums">{money(row.salesAmount)}</td>
                <td className="p-2 text-right tabular-nums">{money(row.grossProfit)}</td>
                <td
                  className={`p-2 text-right font-medium tabular-nums ${row.estimatedProfitAfterFee < 0 ? "text-rose-600 dark:text-rose-300" : "text-emerald-600 dark:text-emerald-300"}`}
                >
                  {money(row.estimatedProfitAfterFee)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
