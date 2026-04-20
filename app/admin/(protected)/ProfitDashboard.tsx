import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  Filter,
  Package,
  ReceiptText,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { getProfitDashboardData } from "@/lib/profit-dashboard";
import { formatDateThai, parseDateOnlyToStartOfDay } from "@/lib/th-date";

type ProfitDashboardProps = {
  profitFrom?: string;
  profitTo?: string;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value: number): string {
  return `${value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function calcChange(current: number, previous: number): number {
  if (Math.abs(previous) < 0.0001) {
    return current === 0 ? 0 : 100;
  }

  return ((current - previous) / Math.abs(previous)) * 100;
}

function getBarHeightClass(ratio: number): string {
  if (ratio >= 0.9) return "h-32";
  if (ratio >= 0.8) return "h-28";
  if (ratio >= 0.7) return "h-24";
  if (ratio >= 0.6) return "h-20";
  if (ratio >= 0.5) return "h-16";
  if (ratio >= 0.4) return "h-14";
  if (ratio >= 0.3) return "h-12";
  if (ratio >= 0.2) return "h-10";
  if (ratio >= 0.1) return "h-8";
  return "h-6";
}

const ProfitDashboard = async ({ profitFrom, profitTo }: ProfitDashboardProps) => {
  const data = await getProfitDashboardData({ from: profitFrom, to: profitTo });
  const todayGrossDelta = data.today.grossProfit - data.yesterday.grossProfit;
  const todayMarginDelta = data.today.marginPct - data.yesterday.marginPct;
  const monthNetDelta = calcChange(
    data.monthComparison.currentMonthNetProfit,
    data.monthComparison.previousMonthNetProfit,
  );
  const monthSalesDelta = calcChange(
    data.monthComparison.currentMonthSales,
    data.monthComparison.previousMonthSales,
  );
  const monthExpenseDelta = calcChange(
    data.monthComparison.currentMonthExpense,
    data.monthComparison.previousMonthExpense,
  );
  const maxTrendSales = Math.max(...data.trend.map((item) => Math.abs(item.salesAmount)), 1);
  const maxTrendGross = Math.max(...data.trend.map((item) => Math.abs(item.grossProfit)), 1);

  const summaryCards = [
    {
      label: "ยอดขายวันนี้",
      value: `${formatMoney(data.today.salesAmount)} บาท`,
      helper: `เทียบเมื่อวาน ${data.yesterday.salesAmount >= 0 ? "+" : ""}${formatMoney(
        data.today.salesAmount - data.yesterday.salesAmount,
      )} บาท`,
      tone: data.today.salesAmount >= data.yesterday.salesAmount ? "emerald" : "rose",
      icon: Banknote,
    },
    {
      label: "ต้นทุนขายวันนี้",
      value: `${formatMoney(data.today.costAmount)} บาท`,
      helper: `อิงต้นทุน snapshot ตอนขายจริง`,
      tone: "amber",
      icon: Package,
    },
    {
      label: "กำไรขั้นต้นวันนี้",
      value: `${formatMoney(data.today.grossProfit)} บาท`,
      helper: `${todayGrossDelta >= 0 ? "ดีกว่า" : "แย่กว่า"}เมื่อวาน ${formatMoney(
        Math.abs(todayGrossDelta),
      )} บาท`,
      tone: data.today.grossProfit >= data.yesterday.grossProfit ? "emerald" : "rose",
      icon: TrendingUp,
    },
    {
      label: "% Margin วันนี้",
      value: formatPercent(data.today.marginPct),
      helper: `${todayMarginDelta >= 0 ? "+" : ""}${formatPercent(todayMarginDelta)} จากเมื่อวาน`,
      tone: data.today.marginPct >= data.yesterday.marginPct ? "emerald" : "rose",
      icon: ReceiptText,
    },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">Profit Dashboard</h1>
        <p className="text-sm text-gray-500">
          โฟกัสกำไรที่เจ้าของต้องใช้ตัดสินใจ: วันนี้กำไรไหม, ตัวไหนทำเงิน/ขาดทุน, และเดือนนี้มีแนวโน้มเหลือเท่าไร
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => {
          const toneClass =
            card.tone === "emerald"
              ? "bg-emerald-50 text-emerald-600"
              : card.tone === "rose"
                ? "bg-rose-50 text-rose-600"
                : "bg-amber-50 text-amber-600";

          return (
            <div key={card.label} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-gray-500">{card.label}</p>
                  <p className="font-kanit text-xl font-semibold text-gray-900">{card.value}</p>
                </div>
                <div className={`rounded-xl p-2 ${toneClass}`}>
                  <card.icon size={18} />
                </div>
              </div>
              <p className="text-xs text-gray-400">{card.helper}</p>
            </div>
          );
        })}
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">ช่วงวิเคราะห์กำไร</p>
            <p className="text-xs text-gray-500">
              ส่วนล่างของ dashboard จะอิงช่วงวันที่นี้ ส่วน Daily Snapshot ด้านบนยังคงแสดงตามวันนี้
            </p>
          </div>
          <form className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input type="hidden" name="tab" value="profit" />
            <label className="space-y-1 text-sm text-gray-600">
              <span>จากวันที่</span>
              <input
                type="date"
                name="profitFrom"
                defaultValue={data.filters.from}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none ring-0"
              />
            </label>
            <label className="space-y-1 text-sm text-gray-600">
              <span>ถึงวันที่</span>
              <input
                type="date"
                name="profitTo"
                defaultValue={data.filters.to}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none ring-0"
              />
            </label>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white"
            >
              <Filter size={16} />
              อัปเดตช่วงวิเคราะห์
            </button>
          </form>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_1fr]">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-kanit text-xl font-semibold text-gray-900">แนวโน้มกำไร</h2>
              <p className="text-xs text-gray-500">
                ช่วง {formatDateThai(parseDateOnlyToStartOfDay(data.filters.from))} ถึง{" "}
                {formatDateThai(parseDateOnlyToStartOfDay(data.filters.to))}
              </p>
            </div>
            <CalendarDays className="text-gray-400" size={18} />
          </div>
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
                <span>ยอดขายรายวัน</span>
                <span>สูงสุด {formatMoney(maxTrendSales)} บาท</span>
              </div>
              <div className="flex h-36 items-end gap-2 overflow-x-auto pb-2">
                {data.trend.map((point) => (
                  <div key={`sales-${point.dateKey}`} className="flex min-w-8 flex-col items-center gap-2">
                    <div
                      className={`w-6 rounded-t-full bg-emerald-400 ${getBarHeightClass(
                        Math.abs(point.salesAmount) / maxTrendSales,
                      )}`}
                    />
                    <span className="text-[10px] text-gray-400">{point.dateKey.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
                <span>กำไรขั้นต้นรายวัน</span>
                <span>สูงสุด {formatMoney(maxTrendGross)} บาท</span>
              </div>
              <div className="flex h-36 items-end gap-2 overflow-x-auto pb-2">
                {data.trend.map((point) => (
                  <div key={`gross-${point.dateKey}`} className="flex min-w-8 flex-col items-center gap-2">
                    <div
                      className={`w-6 rounded-t-full ${
                        point.grossProfit >= 0 ? "bg-sky-500" : "bg-rose-400"
                      } ${getBarHeightClass(Math.abs(point.grossProfit) / maxTrendGross)}`}
                    />
                    <span className="text-[10px] text-gray-400">{point.dateKey.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {[
                {
                  label: "รายได้รวม",
                  value: `${formatMoney(data.monthComparison.currentMonthSales)} บาท`,
                  helper: `${monthSalesDelta >= 0 ? "+" : ""}${formatPercent(monthSalesDelta)} เทียบเดือนก่อน`,
                  positive: data.monthComparison.currentMonthSales >= data.monthComparison.previousMonthSales,
                },
                {
                  label: "ค่าใช้จ่ายรวม",
                  value: `${formatMoney(data.monthComparison.currentMonthExpense)} บาท`,
                  helper: `${monthExpenseDelta >= 0 ? "+" : ""}${formatPercent(monthExpenseDelta)} เทียบเดือนก่อน`,
                  positive: data.monthComparison.currentMonthExpense <= data.monthComparison.previousMonthExpense,
                },
                {
                  label: "กำไรสุทธิเดือนนี้",
                  value: `${formatMoney(data.monthComparison.currentMonthNetProfit)} บาท`,
                  helper: `${monthNetDelta >= 0 ? "+" : ""}${formatPercent(monthNetDelta)} เทียบเดือนก่อน`,
                  positive: data.monthComparison.currentMonthNetProfit >= data.monthComparison.previousMonthNetProfit,
                },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl bg-gray-50 p-4">
                  <p className="text-xs font-medium text-gray-500">{item.label}</p>
                  <p className="mt-1 font-kanit text-xl font-semibold text-gray-900">{item.value}</p>
                  <p className={`mt-2 text-xs ${item.positive ? "text-emerald-600" : "text-rose-600"}`}>
                    {item.helper}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-kanit text-xl font-semibold text-gray-900">Alert / จุดผิดปกติ</h2>
              <p className="text-xs text-gray-500">ช่วยให้เห็นปัญหาใน 5 วินาที</p>
            </div>
            <TrendingDown className="text-gray-400" size={18} />
          </div>
          <div className="space-y-3">
            {data.alerts.length === 0 ? (
              <div className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-700">
                ยังไม่พบสัญญาณเตือนเด่นในช่วงวิเคราะห์
              </div>
            ) : (
              data.alerts.map((alert, index) => (
                <div key={`${alert.kind}-${index}`} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                  <p className="text-sm font-medium text-gray-900">{alert.title}</p>
                  <p className="mt-1 text-xs text-gray-500">{alert.detail}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-kanit text-xl font-semibold text-gray-900">สินค้า Top กำไร</h2>
              <p className="text-xs text-gray-500">Money Maker ของช่วงวิเคราะห์</p>
            </div>
            <ArrowUpRight className="text-emerald-500" size={18} />
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr className="border-b border-gray-100">
                  <th className="pb-3">สินค้า</th>
                  <th className="pb-3 text-right">ยอดขาย</th>
                  <th className="pb-3 text-right">ต้นทุน</th>
                  <th className="pb-3 text-right">กำไร</th>
                  <th className="pb-3 text-right">% Margin</th>
                </tr>
              </thead>
              <tbody>
                {data.topProducts.map((row) => (
                  <tr key={row.productId} className="border-b border-gray-50">
                    <td className="py-3">
                      <p className="font-medium text-gray-900">{row.productName}</p>
                      <p className="text-xs text-gray-400">{row.productCode ?? "-"}</p>
                    </td>
                    <td className="py-3 text-right">{formatMoney(row.salesAmount)}</td>
                    <td className="py-3 text-right">{formatMoney(row.costAmount)}</td>
                    <td className="py-3 text-right font-medium text-emerald-600">{formatMoney(row.grossProfit)}</td>
                    <td className="py-3 text-right">{formatPercent(row.marginPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-kanit text-xl font-semibold text-gray-900">สินค้า กำไรต่ำ / ขาดทุน</h2>
              <p className="text-xs text-gray-500">Killer ที่ต้องรีบตัดสินใจ</p>
            </div>
            <ArrowDownRight className="text-rose-500" size={18} />
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr className="border-b border-gray-100">
                  <th className="pb-3">สินค้า</th>
                  <th className="pb-3 text-right">ยอดขาย</th>
                  <th className="pb-3 text-right">กำไร</th>
                  <th className="pb-3 text-right">กำไร/หน่วย</th>
                  <th className="pb-3 text-right">% Margin</th>
                </tr>
              </thead>
              <tbody>
                {data.lowProducts.map((row) => (
                  <tr key={row.productId} className="border-b border-gray-50">
                    <td className="py-3">
                      <p className="font-medium text-gray-900">{row.productName}</p>
                      <p className="text-xs text-gray-400">{row.productCode ?? "-"}</p>
                    </td>
                    <td className="py-3 text-right">{formatMoney(row.salesAmount)}</td>
                    <td className={`py-3 text-right font-medium ${row.grossProfit >= 0 ? "text-amber-600" : "text-rose-600"}`}>
                      {formatMoney(row.grossProfit)}
                    </td>
                    <td className="py-3 text-right">{formatMoney(row.unitProfit)}</td>
                    <td className="py-3 text-right">{formatPercent(row.marginPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-kanit text-xl font-semibold text-gray-900">Profit by Invoice</h2>
            <p className="text-xs text-gray-500">Drill down กลับไปดูเอกสารที่ทำเงินหรือทำให้กำไรหาย</p>
          </div>
          <ReceiptText className="text-gray-400" size={18} />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr className="border-b border-gray-100">
                <th className="pb-3">เลขที่เอกสาร</th>
                <th className="pb-3">วันที่</th>
                <th className="pb-3">ลูกค้า</th>
                <th className="pb-3 text-right">ยอดขาย</th>
                <th className="pb-3 text-right">ต้นทุน</th>
                <th className="pb-3 text-right">กำไร</th>
                <th className="pb-3 text-right">% Margin</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((row) => (
                <tr key={row.sourceId} className="border-b border-gray-50">
                  <td className="py-3 font-medium text-gray-900">{row.sourceDocNo}</td>
                  <td className="py-3 text-gray-500">{formatDateThai(row.businessDate)}</td>
                  <td className="py-3 text-gray-500">{row.customerName ?? "-"}</td>
                  <td className="py-3 text-right">{formatMoney(row.salesAmount)}</td>
                  <td className="py-3 text-right">{formatMoney(row.costAmount)}</td>
                  <td className={`py-3 text-right font-medium ${row.grossProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {formatMoney(row.grossProfit)}
                  </td>
                  <td className="py-3 text-right">{formatPercent(row.marginPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default ProfitDashboard;
