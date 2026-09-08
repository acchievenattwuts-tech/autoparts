import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  Filter,
  Package,
  ReceiptText,
  TrendingUp,
} from "lucide-react";
import { Suspense } from "react";

import ProfitAlertsSection from "@/app/admin/(protected)/ProfitAlertsSection";
import ProfitCustomerSection from "@/app/admin/(protected)/ProfitCustomerSection";
import ProfitInvoiceSection from "@/app/admin/(protected)/ProfitInvoiceSection";
import {
  formatMoney,
  formatPercent,
  getBasisLabel,
  parsePositivePage,
  ProfitSectionSkeleton,
  type ProfitSectionContext,
} from "@/app/admin/(protected)/ProfitSectionShared";
import ProfitStockSection from "@/app/admin/(protected)/ProfitStockSection";
import ProfitTrendPanel from "@/app/admin/(protected)/ProfitTrendPanelLazy";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import ProfitExplanationPanel from "@/components/shared/ProfitExplanationPanel";
import {
  getProfitDashboardOverview,
  getRevenueAmountByBasis,
  LOW_MARGIN_THRESHOLD_PCT,
} from "@/lib/profit-dashboard";
import { formatDateThai, parseDateOnlyToStartOfDay } from "@/lib/th-date";

type ProfitDashboardProps = {
  profitFrom?: string;
  profitTo?: string;
  profitBasis?: string;
  profitStockPage?: string;
  profitCustomerPage?: string;
  profitInvoicePage?: string;
  profitAlertPage?: string;
};

function calcChange(current: number, previous: number): number {
  if (Math.abs(previous) < 0.0001) {
    return current === 0 ? 0 : 100;
  }

  return ((current - previous) / Math.abs(previous)) * 100;
}

const ProfitDashboard = async ({
  profitFrom,
  profitTo,
  profitBasis,
  profitStockPage,
  profitCustomerPage,
  profitInvoicePage,
  profitAlertPage,
}: ProfitDashboardProps) => {
  const data = await getProfitDashboardOverview({
    from: profitFrom,
    to: profitTo,
    basis: profitBasis === "inc_vat" ? "inc_vat" : "ex_vat",
  });
  const basis = data.filters.basis;
  const basisLabel = getBasisLabel(basis);
  const todaySales = getRevenueAmountByBasis(
    {
      exVat: data.today.salesAmountExVat,
      incVat: data.today.salesAmountIncVat,
    },
    basis,
  );
  const yesterdaySales = getRevenueAmountByBasis(
    {
      exVat: data.yesterday.salesAmountExVat,
      incVat: data.yesterday.salesAmountIncVat,
    },
    basis,
  );
  const selectedRangeSales = getRevenueAmountByBasis(
    {
      exVat: data.selectedRange.salesAmountExVat,
      incVat: data.selectedRange.salesAmountIncVat,
    },
    basis,
  );
  const previousRangeSales = getRevenueAmountByBasis(
    {
      exVat: data.previousRange.salesAmountExVat,
      incVat: data.previousRange.salesAmountIncVat,
    },
    basis,
  );
  const todayGrossDelta = data.today.grossProfit - data.yesterday.grossProfit;
  const todayMarginDelta = data.today.marginPct - data.yesterday.marginPct;
  const rangeNetDelta = calcChange(
    data.selectedRange.netProfitAmount,
    data.previousRange.netProfitAmount,
  );
  const rangeSalesDelta = calcChange(selectedRangeSales, previousRangeSales);
  const rangeExpenseDelta = calcChange(
    data.selectedRange.expenseAmount,
    data.previousRange.expenseAmount,
  );
  const trendChartData = data.trend.map((point) => ({
    dateKey: point.dateKey,
    shortLabel: point.dateKey.slice(5),
    fullLabel: formatDateThai(parseDateOnlyToStartOfDay(point.dateKey)),
    salesAmount: getRevenueAmountByBasis(
      {
        exVat: point.salesAmountExVat,
        incVat: point.salesAmountIncVat,
      },
      basis,
    ),
    grossProfit: point.grossProfit,
    marginPct: point.marginPct,
  }));
  /**
   * เลขหน้าอ่านจาก URL ตรง ๆ ไม่ต้องรอผลของตารางไหนก่อน dashboard จึงส่ง context ให้
   * ทุก section ได้ทันที และแต่ละ section ไป await ข้อมูลของตัวเองใน <Suspense> ของมันเอง
   */
  const context: ProfitSectionContext = {
    from: data.filters.from,
    to: data.filters.to,
    basis,
    stockPage: parsePositivePage(profitStockPage),
    customerPage: parsePositivePage(profitCustomerPage),
    invoicePage: parsePositivePage(profitInvoicePage),
    alertPage: parsePositivePage(profitAlertPage),
  };
  const hasSelectedRangeActivity =
    Math.abs(selectedRangeSales) > 0.0001 ||
    Math.abs(data.selectedRange.expenseAmount) > 0.0001 ||
    Math.abs(data.selectedRange.netProfitAmount) > 0.0001;

  const summaryCards = [
    {
      label: `ยอดขายวันนี้ (${basisLabel})`,
      value: `${formatMoney(todaySales)} บาท`,
      helper: `เทียบเมื่อวาน ${yesterdaySales >= 0 ? "+" : ""}${formatMoney(todaySales - yesterdaySales)} บาท`,
      tone: todaySales >= yesterdaySales ? "emerald" : "rose",
      icon: Banknote,
    },
    {
      label: "ต้นทุนขายวันนี้",
      value: `${formatMoney(data.today.costAmount)} บาท`,
      helper: "อิงต้นทุน snapshot ตอนขายจริง",
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

  const rangeSummaryCards = [
    {
      label: `รายได้รวมช่วงนี้ (${basisLabel})`,
      value: `${formatMoney(selectedRangeSales)} บาท`,
      helper: `${rangeSalesDelta >= 0 ? "+" : ""}${formatPercent(rangeSalesDelta)} เทียบช่วงก่อนหน้าความยาวเท่ากัน`,
      positive: selectedRangeSales >= previousRangeSales,
    },
    {
      label: "ค่าใช้จ่ายรวมช่วงนี้",
      value: `${formatMoney(data.selectedRange.expenseAmount)} บาท`,
      helper: `${rangeExpenseDelta >= 0 ? "+" : ""}${formatPercent(rangeExpenseDelta)} เทียบช่วงก่อนหน้าความยาวเท่ากัน`,
      positive: data.selectedRange.expenseAmount <= data.previousRange.expenseAmount,
    },
    {
      label: "กำไรสุทธิช่วงนี้",
      value: `${formatMoney(data.selectedRange.netProfitAmount)} บาท`,
      helper: `${rangeNetDelta >= 0 ? "+" : ""}${formatPercent(rangeNetDelta)} เทียบช่วงก่อนหน้าความยาวเท่ากัน`,
      positive: data.selectedRange.netProfitAmount >= data.previousRange.netProfitAmount,
    },
  ] as const;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Dashboard"
        title="Profit Dashboard"
        description="โฟกัสกำไรที่เจ้าของต้องใช้ตัดสินใจ: วันนี้กำไรไหม, ตัวไหนทำเงินหรือขาดทุน, และช่วงที่เลือกกำลังดีขึ้นหรือแย่ลง"
      />

      <section className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-5 shadow-sm dark:border-emerald-400/20">
        <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
              Snapshot Today
            </p>
            <h2 className="font-kanit text-xl font-semibold text-gray-900 dark:text-slate-100">
              มุมมองวันนี้แบบไม่ติด filter
            </h2>
            <p className="text-xs text-gray-500 dark:text-slate-400">
              การ์ดชุดนี้ยึดตามวันนี้เสมอ เพื่อให้เห็นภาพกำไรของวันทันที
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-100 bg-white/80 px-4 py-3 text-sm text-gray-600 dark:border-emerald-400/20 dark:bg-slate-950/70 dark:text-slate-300">
            <p className="font-medium text-gray-900">ฐานอ้างอิงของการ์ดชุดนี้</p>
            <p>ยอดขายสลับได้ระหว่าง ก่อน VAT / รวม VAT</p>
            <p>กำไรและ % Margin ยึดก่อน VAT เสมอ</p>
          </div>
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
              <div key={card.label} className="rounded-2xl border border-white bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
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
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">ช่วงวิเคราะห์กำไร</p>
            <p className="text-xs text-gray-500 dark:text-slate-400">
              ส่วนล่างของ dashboard จะอิงช่วงวันที่นี้ ส่วน Snapshot ด้านบนยังคงแสดงตามวันนี้
            </p>
          </div>
          <AdminSearchForm method="GET" className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <input type="hidden" name="tab" value="profit" />
            <label className="space-y-1 text-sm text-gray-600">
              <span>จากวันที่</span>
              <input
                type="date"
                name="profitFrom"
                defaultValue={data.filters.from}
                className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none ring-0 focus:border-sky-300 focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-sky-400/60 dark:focus:ring-sky-400/20"
              />
            </label>
            <label className="space-y-1 text-sm text-gray-600">
              <span>ถึงวันที่</span>
              <input
                type="date"
                name="profitTo"
                defaultValue={data.filters.to}
                className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none ring-0 focus:border-sky-300 focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-sky-400/60 dark:focus:ring-sky-400/20"
              />
            </label>
            <label className="space-y-1 text-sm text-gray-600">
              <span>มุมมองยอดขาย</span>
              <select
                name="profitBasis"
                defaultValue={basis}
                className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none ring-0 focus:border-sky-300 focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-sky-400/60 dark:focus:ring-sky-400/20"
              >
                <option value="ex_vat">ก่อน VAT</option>
                <option value="inc_vat">รวม VAT</option>
              </select>
            </label>
            <AdminSearchSubmitButton className="self-end justify-center rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-sky-200 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-slate-200 dark:focus:ring-sky-400/30">
              <Filter size={16} />
              อัปเดตช่วงวิเคราะห์
            </AdminSearchSubmitButton>
          </AdminSearchForm>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 text-sm text-gray-600 sm:grid-cols-4">
          <div className="rounded-2xl bg-gray-50 px-4 py-3 dark:bg-white/5">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">ช่วงวิเคราะห์</p>
            <p className="mt-1 font-medium text-gray-900">
              {formatDateThai(parseDateOnlyToStartOfDay(data.filters.from))} -{" "}
              {formatDateThai(parseDateOnlyToStartOfDay(data.filters.to))}
            </p>
          </div>
          <div className="rounded-2xl bg-gray-50 px-4 py-3 dark:bg-white/5">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">มุมมองยอดขาย</p>
            <p className="mt-1 text-gray-900">{basisLabel}</p>
          </div>
          <div className="rounded-2xl bg-gray-50 px-4 py-3 dark:bg-white/5">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">ชั้นข้อมูล</p>
            <p className="mt-1 text-gray-900">อ่านจาก `fact_profit` และรวม SALE, SALE_RETURN, EXPENSE</p>
          </div>
          <div className="rounded-2xl bg-amber-50 px-4 py-3 text-amber-900">
            <p className="text-xs font-medium uppercase tracking-wide text-amber-700">Helper</p>
            <p className="mt-1">
              dropdown นี้เปลี่ยนเฉพาะยอดขายและกราฟหรือตารางที่อิงยอดขาย ส่วนกำไรและ % Margin ยังใช้ฐานก่อน VAT
            </p>
          </div>
        </div>
      </section>

      <ProfitExplanationPanel filters={data.filters} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_1fr]">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-kanit text-xl font-semibold text-gray-900 dark:text-slate-100">แนวโน้มกำไร</h2>
              <p className="text-xs text-gray-500 dark:text-slate-400">
                ช่วง {formatDateThai(parseDateOnlyToStartOfDay(data.filters.from))} ถึง{" "}
                {formatDateThai(parseDateOnlyToStartOfDay(data.filters.to))}
              </p>
            </div>
            <CalendarDays className="text-gray-400" size={18} />
          </div>
          <div className="space-y-4">
            <ProfitTrendPanel
              basisLabel={basisLabel}
              data={trendChartData}
              hasSelectedRangeActivity={hasSelectedRangeActivity}
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {rangeSummaryCards.map((item) => (
                <div key={item.label} className="rounded-2xl bg-gray-50 p-4 dark:bg-white/5">
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

        <Suspense fallback={<ProfitSectionSkeleton rows={6} />}>
          <ProfitAlertsSection context={context} />
        </Suspense>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-kanit text-xl font-semibold text-gray-900 dark:text-slate-100">สินค้าเด่นทำกำไร</h2>
              <p className="text-xs text-gray-500 dark:text-slate-400">
                Spotlight เฉพาะตัวที่ทำกำไรเด่นสุด เพื่อดูเร็วว่าช่วงนี้อะไรเป็นตัวขับกำไร
              </p>
            </div>
            <ArrowUpRight className="text-emerald-500" size={18} />
          </div>
          <div className="grid grid-cols-1 gap-3">
            {data.topProducts.map((row, index) => (
              <div key={row.productId} className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                      Top {index + 1}
                    </p>
                    <p className="mt-1 font-medium text-gray-900">{row.productName}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">{row.productCode ?? "-"}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 dark:text-slate-400">กำไร</p>
                    <p className="font-kanit text-xl font-semibold text-emerald-700">
                      {formatMoney(row.grossProfit)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3 text-xs text-gray-600">
                  <div>
                    <p className="text-gray-500">ยอดขาย ({basisLabel})</p>
                    <p className="mt-1 font-medium text-gray-900">
                      {formatMoney(
                        getRevenueAmountByBasis(
                          {
                            exVat: row.salesAmountExVat,
                            incVat: row.salesAmountIncVat,
                          },
                          basis,
                        ),
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">กำไร/หน่วย</p>
                    <p className="mt-1 font-medium text-gray-900">{formatMoney(row.unitProfit)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">% Margin</p>
                    <p className="mt-1 font-medium text-gray-900">{formatPercent(row.marginPct)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-kanit text-xl font-semibold text-gray-900 dark:text-slate-100">สินค้าเสี่ยงกำไรต่ำ</h2>
              <p className="text-xs text-gray-500 dark:text-slate-400">
                Watchlist เฉพาะสินค้าที่ margin ต่ำกว่า {LOW_MARGIN_THRESHOLD_PCT}% หรือขาดทุน
              </p>
            </div>
            <ArrowDownRight className="text-rose-500" size={18} />
          </div>
          <div className="grid grid-cols-1 gap-3">
            {data.lowProducts.length === 0 ? (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-sm text-emerald-700">
                ไม่มีสินค้าที่กำไรต่ำกว่าเกณฑ์ ({LOW_MARGIN_THRESHOLD_PCT}%) หรือขาดทุนในช่วงนี้
              </div>
            ) : null}
            {data.lowProducts.map((row, index) => (
              <div key={row.productId} className="rounded-2xl border border-rose-100 bg-rose-50/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">
                      Watch {index + 1}
                    </p>
                    <p className="mt-1 font-medium text-gray-900">{row.productName}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">{row.productCode ?? "-"}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 dark:text-slate-400">กำไร</p>
                    <p
                      className={`font-kanit text-xl font-semibold ${
                        row.grossProfit >= 0 ? "text-amber-700" : "text-rose-700"
                      }`}
                    >
                      {formatMoney(row.grossProfit)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3 text-xs text-gray-600">
                  <div>
                    <p className="text-gray-500">ยอดขาย ({basisLabel})</p>
                    <p className="mt-1 font-medium text-gray-900">
                      {formatMoney(
                        getRevenueAmountByBasis(
                          {
                            exVat: row.salesAmountExVat,
                            incVat: row.salesAmountIncVat,
                          },
                          basis,
                        ),
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">กำไร/หน่วย</p>
                    <p className="mt-1 font-medium text-gray-900">{formatMoney(row.unitProfit)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">% Margin</p>
                    <p className="mt-1 font-medium text-gray-900">{formatPercent(row.marginPct)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <Suspense fallback={<ProfitSectionSkeleton rows={10} />}>
        <ProfitStockSection context={context} />
      </Suspense>

      <Suspense fallback={<ProfitSectionSkeleton rows={10} />}>
        <ProfitCustomerSection context={context} />
      </Suspense>

      <Suspense fallback={<ProfitSectionSkeleton rows={10} />}>
        <ProfitInvoiceSection context={context} />
      </Suspense>
    </div>
  );
};

export default ProfitDashboard;

