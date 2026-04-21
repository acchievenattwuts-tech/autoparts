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
import Link from "next/link";

import ProfitTrendPanel from "@/app/admin/(protected)/ProfitTrendPanel";
import {
  getProfitDashboardData,
  getRevenueAmountByBasis,
  type ProfitRevenueBasis,
} from "@/lib/profit-dashboard";
import { ProfitSourceType } from "@/lib/generated/prisma";
import { formatDateThai, parseDateOnlyToStartOfDay } from "@/lib/th-date";

type ProfitDashboardProps = {
  profitFrom?: string;
  profitTo?: string;
  profitBasis?: string;
  profitStockPage?: string;
  profitCustomerPage?: string;
  profitInvoicePage?: string;
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


function buildInvoiceHref(sourceType: ProfitSourceType, sourceId: string): string {
  if (sourceType === ProfitSourceType.SALE_RETURN) {
    return `/admin/credit-notes/${sourceId}`;
  }

  return `/admin/sales/${sourceId}`;
}

function buildCustomerHref(customerId: string | null): string | null {
  if (!customerId) {
    return null;
  }

  return `/admin/customers/${customerId}`;
}

function buildProductHref(productId: string | null): string | null {
  if (!productId) {
    return null;
  }

  return `/admin/products/${productId}/edit`;
}

function buildSalesDrilldownHref(options: {
  from: string;
  to: string;
  customerId?: string | null;
  productId?: string | null;
}): string {
  const params = new URLSearchParams({
    from: options.from,
    to: options.to,
  });

  if (options.customerId) {
    params.set("customerId", options.customerId);
  }
  if (options.productId) {
    params.set("productId", options.productId);
  }

  return `/admin/sales?${params.toString()}`;
}

function buildCreditNoteDrilldownHref(options: {
  from: string;
  to: string;
  customerId?: string | null;
  productId?: string | null;
}): string {
  const params = new URLSearchParams({
    from: options.from,
    to: options.to,
  });

  if (options.customerId) {
    params.set("customerId", options.customerId);
  }
  if (options.productId) {
    params.set("productId", options.productId);
  }

  return `/admin/credit-notes?${params.toString()}`;
}

function getBasisLabel(basis: ProfitRevenueBasis): string {
  return basis === "inc_vat" ? "รวม VAT" : "ก่อน VAT";
}

function getAlertSeverityLabel(severity: "high" | "medium" | "low"): string {
  if (severity === "high") return "สูง";
  if (severity === "medium") return "กลาง";
  return "ต่ำ";
}

function parsePositivePage(value?: string): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function buildProfitDashboardHref(options: {
  from: string;
  to: string;
  basis: ProfitRevenueBasis;
  stockPage?: number;
  customerPage?: number;
  invoicePage?: number;
}): string {
  const params = new URLSearchParams({
    tab: "profit",
    profitFrom: options.from,
    profitTo: options.to,
    profitBasis: options.basis,
  });

  if (options.stockPage && options.stockPage > 1) {
    params.set("profitStockPage", String(options.stockPage));
  }
  if (options.customerPage && options.customerPage > 1) {
    params.set("profitCustomerPage", String(options.customerPage));
  }
  if (options.invoicePage && options.invoicePage > 1) {
    params.set("profitInvoicePage", String(options.invoicePage));
  }

  return `/admin?${params.toString()}`;
}

function getVisiblePages(currentPage: number, totalPages: number): number[] {
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);
  const pages: number[] = [];

  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }

  return pages;
}

function SectionPagination({
  currentPage,
  totalPages,
  buildHref,
}: {
  currentPage: number;
  totalPages: number;
  buildHref: (page: number) => string;
}) {
  if (totalPages <= 1) {
    return null;
  }

  const visiblePages = getVisiblePages(currentPage, totalPages);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-white/10">
      <p className="text-xs text-gray-500">
        หน้า {currentPage} จาก {totalPages}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {currentPage > 1 ? (
          <Link
            href={buildHref(currentPage - 1)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
          >
            ก่อนหน้า
          </Link>
        ) : null}
        {visiblePages[0] > 1 ? (
          <>
            <Link
              href={buildHref(1)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
            >
              1
            </Link>
            {visiblePages[0] > 2 ? <span className="px-1 text-xs text-gray-400">...</span> : null}
          </>
        ) : null}
        {visiblePages.map((page) => (
          <Link
            key={page}
            href={buildHref(page)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              page === currentPage
                ? "bg-gray-900 text-white dark:bg-slate-100 dark:text-slate-950"
                : "border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
            }`}
          >
            {page}
          </Link>
        ))}
        {visiblePages[visiblePages.length - 1] < totalPages ? (
          <>
            {visiblePages[visiblePages.length - 1] < totalPages - 1 ? (
              <span className="px-1 text-xs text-gray-400">...</span>
            ) : null}
            <Link
              href={buildHref(totalPages)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
            >
              {totalPages}
            </Link>
          </>
        ) : null}
        {currentPage < totalPages ? (
          <Link
            href={buildHref(currentPage + 1)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
          >
            ถัดไป
          </Link>
        ) : null}
      </div>
    </div>
  );
}

const ProfitDashboard = async ({
  profitFrom,
  profitTo,
  profitBasis,
  profitStockPage,
  profitCustomerPage,
  profitInvoicePage,
}: ProfitDashboardProps) => {
  const stockPage = parsePositivePage(profitStockPage);
  const customerPage = parsePositivePage(profitCustomerPage);
  const invoicePage = parsePositivePage(profitInvoicePage);
  const data = await getProfitDashboardData({
    from: profitFrom,
    to: profitTo,
    basis: profitBasis === "inc_vat" ? "inc_vat" : "ex_vat",
    stockPage,
    customerPage,
    invoicePage,
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
  const currentStockPage = data.stockProducts.pagination.page;
  const currentCustomerPage = data.customerAnalysis.pagination.page;
  const currentInvoicePage = data.invoices.pagination.page;
  const stockTotalPages = data.stockProducts.pagination.totalPages;
  const customerTotalPages = data.customerAnalysis.pagination.totalPages;
  const invoiceTotalPages = data.invoices.pagination.totalPages;
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
      <div className="space-y-1">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">Profit Dashboard</h1>
        <p className="text-sm text-gray-500">
          โฟกัสกำไรที่เจ้าของต้องใช้ตัดสินใจ: วันนี้กำไรไหม, ตัวไหนทำเงินหรือขาดทุน, และช่วงที่เลือกกำลังดีขึ้นหรือแย่ลง
        </p>
      </div>

      <section className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-5 shadow-sm dark:border-emerald-400/20">
        <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
              Snapshot Today
            </p>
            <h2 className="font-kanit text-xl font-semibold text-gray-900">
              มุมมองวันนี้แบบไม่ติด filter
            </h2>
            <p className="text-xs text-gray-500">
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
            <p className="text-xs text-gray-500">
              ส่วนล่างของ dashboard จะอิงช่วงวันที่นี้ ส่วน Snapshot ด้านบนยังคงแสดงตามวันนี้
            </p>
          </div>
          <form className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <input type="hidden" name="tab" value="profit" />
            <label className="space-y-1 text-sm text-gray-600">
              <span>จากวันที่</span>
              <input
                type="date"
                name="profitFrom"
                defaultValue={data.filters.from}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none ring-0 focus:border-sky-300 focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-sky-400/60 dark:focus:ring-sky-400/20"
              />
            </label>
            <label className="space-y-1 text-sm text-gray-600">
              <span>ถึงวันที่</span>
              <input
                type="date"
                name="profitTo"
                defaultValue={data.filters.to}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none ring-0 focus:border-sky-300 focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-sky-400/60 dark:focus:ring-sky-400/20"
              />
            </label>
            <label className="space-y-1 text-sm text-gray-600">
              <span>มุมมองยอดขาย</span>
              <select
                name="profitBasis"
                defaultValue={basis}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none ring-0 focus:border-sky-300 focus:ring-2 focus:ring-sky-200/60 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-sky-400/60 dark:focus:ring-sky-400/20"
              >
                <option value="ex_vat">ก่อน VAT</option>
                <option value="inc_vat">รวม VAT</option>
              </select>
            </label>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-sky-200 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-slate-200 dark:focus:ring-sky-400/30"
            >
              <Filter size={16} />
              อัปเดตช่วงวิเคราะห์
            </button>
          </form>
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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_1fr]">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
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

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-kanit text-xl font-semibold text-gray-900">Alert / จุดผิดปกติ</h2>
              <p className="text-xs text-gray-500">
                เรียงเคสตามความรุนแรง สูง ไป กลาง ไป ต่ำ เพื่อให้ไล่แก้จากเรื่องที่กระทบกำไรที่สุดก่อน
              </p>
            </div>
            <TrendingDown className="text-gray-400" size={18} />
          </div>
          <div className="mb-3 rounded-2xl bg-gray-50 p-4 text-xs text-gray-600 dark:bg-white/5 dark:text-slate-300">
            <p>Alert ชุดนี้ scan ครบทุกสินค้าที่มีรายการในช่วงวิเคราะห์ ไม่ได้ดูเฉพาะสินค้า Top/Bottom เท่านั้น</p>
            <p className="mt-1">
              กำไรและ margin ใช้ฐานก่อน VAT เสมอ และแต่ละการ์ดกดต่อไปดูสินค้า หรือเปิดชุดบิลต้นเหตุในหน้าขายและคืนสินค้าได้ทันที
            </p>
          </div>
          <div className="space-y-3">
            {data.alerts.length === 0 ? (
              <div className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-200">
                ยังไม่พบสัญญาณเตือนเด่นในช่วงวิเคราะห์
              </div>
            ) : (
              data.alerts.map((alert, index) => {
                const productHref = buildProductHref(alert.productId);

                return (
                  <div
                    key={`${alert.kind}-${alert.productId ?? index}`}
                    className={`rounded-2xl border p-4 ${
                      alert.severity === "high"
                        ? "border-rose-200 bg-rose-50/60"
                        : alert.severity === "medium"
                          ? "border-amber-200 bg-amber-50/60"
                          : "border-sky-200 bg-sky-50/60"
                    }`}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                              alert.severity === "high"
                                ? "bg-rose-100 text-rose-700"
                                : alert.severity === "medium"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-sky-100 text-sky-700"
                            }`}
                          >
                            ระดับ {getAlertSeverityLabel(alert.severity)}
                          </span>
                          <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-medium text-gray-600 dark:bg-slate-950/70 dark:text-slate-300">
                            {alert.kind === "loss"
                              ? "สินค้าขาดทุน"
                              : alert.kind === "low_margin"
                                ? "มาร์จิ้นต่ำ"
                                : "ต้นทุนเฉลี่ยพุ่ง"}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-gray-900">{alert.title}</p>
                        <p className="text-xs text-gray-500">{alert.detail}</p>
                        <p className="text-xs text-gray-500">
                          {alert.productCode ? `รหัส ${alert.productCode} · ` : ""}
                          พบผลกระทบใน {alert.invoiceCount.toLocaleString("th-TH")} บิลภายในช่วงที่เลือก
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs">
                        {productHref ? (
                          <Link
                            href={productHref}
                            className="text-sky-700 underline-offset-2 hover:underline"
                          >
                            เปิดสินค้า
                          </Link>
                        ) : null}
                        {alert.productId ? (
                          <Link
                            href={buildSalesDrilldownHref({
                              from: data.filters.from,
                              to: data.filters.to,
                              productId: alert.productId,
                            })}
                            className="text-sky-700 underline-offset-2 hover:underline"
                          >
                            ดูบิลขายต้นเหตุ
                          </Link>
                        ) : null}
                        {alert.productId ? (
                          <Link
                            href={buildCreditNoteDrilldownHref({
                              from: data.filters.from,
                              to: data.filters.to,
                              productId: alert.productId,
                            })}
                            className="text-sky-700 underline-offset-2 hover:underline"
                          >
                            ดูบิลคืนที่เกี่ยวข้อง
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-kanit text-xl font-semibold text-gray-900">สินค้าเด่นทำกำไร</h2>
              <p className="text-xs text-gray-500">
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
                    <p className="text-xs text-gray-500">{row.productCode ?? "-"}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">กำไร</p>
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
              <h2 className="font-kanit text-xl font-semibold text-gray-900">สินค้าเสี่ยงกำไรต่ำ</h2>
              <p className="text-xs text-gray-500">
                Watchlist สำหรับตัวที่ควรเฝ้าระวังเป็นพิเศษ เพราะกำไรบางหรือเริ่มติดลบ
              </p>
            </div>
            <ArrowDownRight className="text-rose-500" size={18} />
          </div>
          <div className="grid grid-cols-1 gap-3">
            {data.lowProducts.map((row, index) => (
              <div key={row.productId} className="rounded-2xl border border-rose-100 bg-rose-50/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">
                      Watch {index + 1}
                    </p>
                    <p className="mt-1 font-medium text-gray-900">{row.productName}</p>
                    <p className="text-xs text-gray-500">{row.productCode ?? "-"}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">กำไร</p>
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

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-kanit text-xl font-semibold text-gray-900">Profit by Stock</h2>
            <p className="text-xs text-gray-500">
              มุมมองกำไรรวมแยกตามสินค้า จากยอดขายและคืนขายที่เกิดขึ้นจริงในช่วงวิเคราะห์
            </p>
          </div>
          <Package className="text-gray-400" size={18} />
        </div>
        <div className="mb-3 rounded-2xl bg-sky-50 p-4 text-xs text-sky-900">
          นิยามรอบนี้: `Profit by Stock` หมายถึงกำไรรวมแยกตามสินค้า ไม่ใช่กำไรระดับ lot หรือ stock movement
        </div>
        <div className="mb-3 text-xs text-gray-500">
          ตารางนี้เหมาะกับการวิเคราะห์ทั้งชุด ถ้ารายการยาวจะเปิดเป็นหลายหน้าเพื่อลดภาระการดึงข้อมูลและการอ่านบนหน้าเดียว
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr className="border-b border-gray-100">
                <th className="pb-3">สินค้า</th>
                <th className="pb-3 text-right">จำนวนขายสุทธิ</th>
                <th className="pb-3 text-right">ยอดขาย ({basisLabel})</th>
                <th className="pb-3 text-right">ต้นทุน</th>
                <th className="pb-3 text-right">กำไร</th>
                <th className="pb-3 text-right">กำไร/หน่วย</th>
                <th className="pb-3 text-right">% Margin</th>
              </tr>
            </thead>
            <tbody>
              {data.stockProducts.items.map((row) => (
                <tr key={`stock-${row.productId}`} className="border-b border-gray-50">
                  <td className="py-3">
                    <p className="font-medium text-gray-900">{row.productName}</p>
                    <p className="text-xs text-gray-400">{row.productCode ?? "-"}</p>
                    <div className="mt-1 flex gap-3 text-xs">
                      <Link
                        href={buildSalesDrilldownHref({
                          from: data.filters.from,
                          to: data.filters.to,
                          productId: row.productId,
                        })}
                        className="text-sky-700 underline-offset-2 hover:underline"
                      >
                        เปิดหน้าขาย
                      </Link>
                      <Link
                        href={buildCreditNoteDrilldownHref({
                          from: data.filters.from,
                          to: data.filters.to,
                          productId: row.productId,
                        })}
                        className="text-sky-700 underline-offset-2 hover:underline"
                      >
                        เปิดหน้าคืนสินค้า
                      </Link>
                    </div>
                  </td>
                  <td className="py-3 text-right">
                    {row.quantity.toLocaleString("th-TH", { maximumFractionDigits: 4 })}
                  </td>
                  <td className="py-3 text-right">
                    {formatMoney(
                      getRevenueAmountByBasis(
                        {
                          exVat: row.salesAmountExVat,
                          incVat: row.salesAmountIncVat,
                        },
                        basis,
                      ),
                    )}
                  </td>
                  <td className="py-3 text-right">{formatMoney(row.costAmount)}</td>
                  <td
                    className={`py-3 text-right font-medium ${
                      row.grossProfit >= 0 ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {formatMoney(row.grossProfit)}
                  </td>
                  <td className="py-3 text-right">{formatMoney(row.unitProfit)}</td>
                  <td className="py-3 text-right">{formatPercent(row.marginPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SectionPagination
          currentPage={currentStockPage}
          totalPages={stockTotalPages}
          buildHref={(page) =>
            buildProfitDashboardHref({
              from: data.filters.from,
              to: data.filters.to,
              basis,
              stockPage: page,
              customerPage: currentCustomerPage,
              invoicePage: currentInvoicePage,
            })
          }
        />
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-kanit text-xl font-semibold text-gray-900">Profit by Customer</h2>
            <p className="text-xs text-gray-500">
              ดูว่าลูกค้ากลุ่มไหนช่วยทำกำไรสูง และใครที่มาร์จิ้นบางจนควรทบทวนราคา ส่วนลด หรือเงื่อนไขขาย
            </p>
          </div>
          <ArrowUpRight className="text-sky-500" size={18} />
        </div>
        <div className="mb-3 rounded-2xl bg-gray-50 p-4 text-xs text-gray-600">
          ยอดขายสลับตาม dropdown ส่วนกำไรและ % Margin ใช้ฐานก่อน VAT และกดชื่อลูกค้าเพื่อ drill down ไปดูเอกสารต้นเหตุได้
        </div>
        <div className="mb-3 text-xs text-gray-500">
          ตารางนี้แบ่งหน้าเมื่อรายการเยอะ เพื่อให้เปิดวิเคราะห์ลูกค้าได้เร็วขึ้นและไม่ต้องโหลดข้อมูลยาวเกินจำเป็นในรอบเดียว
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr className="border-b border-gray-100">
                <th className="pb-3">ลูกค้า</th>
                <th className="pb-3 text-right">จำนวนบิล</th>
                <th className="pb-3 text-right">จำนวนขายสุทธิ</th>
                <th className="pb-3 text-right">ยอดขาย ({basisLabel})</th>
                <th className="pb-3 text-right">ต้นทุน</th>
                <th className="pb-3 text-right">กำไร</th>
                <th className="pb-3 text-right">% Margin</th>
              </tr>
            </thead>
            <tbody>
              {data.customerAnalysis.items.map((row) => {
                const customerHref = buildCustomerHref(row.customerId);

                return (
                  <tr key={`${row.customerId ?? row.customerName}-customer-profit`} className="border-b border-gray-50">
                    <td className="py-3">
                      {customerHref ? (
                        <Link
                          href={customerHref}
                          className="font-medium text-sky-700 underline-offset-2 hover:underline"
                        >
                          {row.customerName}
                        </Link>
                      ) : (
                        <p className="font-medium text-gray-900">{row.customerName}</p>
                      )}
                      <p className="text-xs text-gray-400">
                        {row.customerId ? "ดูลูกค้ารายนี้ต่อได้" : "ลูกค้าที่ไม่มี master record"}
                      </p>
                      {row.customerId ? (
                        <div className="mt-1 flex gap-3 text-xs">
                          <Link
                            href={buildSalesDrilldownHref({
                              from: data.filters.from,
                              to: data.filters.to,
                              customerId: row.customerId,
                            })}
                            className="text-sky-700 underline-offset-2 hover:underline"
                          >
                            ดูบิลขาย
                          </Link>
                          <Link
                            href={buildCreditNoteDrilldownHref({
                              from: data.filters.from,
                              to: data.filters.to,
                              customerId: row.customerId,
                            })}
                            className="text-sky-700 underline-offset-2 hover:underline"
                          >
                            ดูบิลคืน
                          </Link>
                        </div>
                      ) : null}
                    </td>
                    <td className="py-3 text-right">{row.invoiceCount.toLocaleString("th-TH")}</td>
                    <td className="py-3 text-right">
                      {row.quantity.toLocaleString("th-TH", { maximumFractionDigits: 4 })}
                    </td>
                    <td className="py-3 text-right">
                      {formatMoney(
                        getRevenueAmountByBasis(
                          {
                            exVat: row.salesAmountExVat,
                            incVat: row.salesAmountIncVat,
                          },
                          basis,
                        ),
                      )}
                    </td>
                    <td className="py-3 text-right">{formatMoney(row.costAmount)}</td>
                    <td
                      className={`py-3 text-right font-medium ${
                        row.grossProfit >= 0 ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {formatMoney(row.grossProfit)}
                    </td>
                    <td className="py-3 text-right">{formatPercent(row.marginPct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <SectionPagination
          currentPage={currentCustomerPage}
          totalPages={customerTotalPages}
          buildHref={(page) =>
            buildProfitDashboardHref({
              from: data.filters.from,
              to: data.filters.to,
              basis,
              stockPage: currentStockPage,
              customerPage: page,
              invoicePage: currentInvoicePage,
            })
          }
        />
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-kanit text-xl font-semibold text-gray-900">Profit by Invoice</h2>
            <p className="text-xs text-gray-500">
              Drill down กลับไปดูเอกสารที่ทำเงิน หรือเอกสารที่ทำให้กำไรหายได้โดยตรง
            </p>
          </div>
          <ReceiptText className="text-gray-400" size={18} />
        </div>
        <div className="mb-3 rounded-2xl bg-gray-50 p-4 text-xs text-gray-600">
          ยอดขายในตารางนี้สลับตาม dropdown ส่วนกำไรและ % Margin ยังใช้ฐานก่อน VAT เสมอ
        </div>
        <div className="mb-3 text-xs text-gray-500">
          ตารางนี้แบ่งหน้าเมื่อจำนวนเอกสารมากขึ้น เพื่อให้เลือกดูบิลต้นเหตุได้เร็วและไม่ต้องดึงทั้งช่วงมาทีเดียว
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr className="border-b border-gray-100">
                <th className="pb-3">เลขที่เอกสาร</th>
                <th className="pb-3">วันที่</th>
                <th className="pb-3">ลูกค้า</th>
                <th className="pb-3 text-right">ยอดขาย ({basisLabel})</th>
                <th className="pb-3 text-right">ต้นทุน</th>
                <th className="pb-3 text-right">กำไร</th>
                <th className="pb-3 text-right">% Margin</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.items.map((row) => (
                <tr key={`${row.sourceType}-${row.sourceId}`} className="border-b border-gray-50">
                  <td className="py-3">
                    <Link
                      href={buildInvoiceHref(row.sourceType, row.sourceId)}
                      className="font-medium text-sky-700 underline-offset-2 hover:underline"
                    >
                      {row.sourceDocNo}
                    </Link>
                    <p className="text-xs text-gray-400">
                      {row.sourceType === ProfitSourceType.SALE ? "Sale" : "Credit Note Return"}
                    </p>
                  </td>
                  <td className="py-3 text-gray-500">{formatDateThai(row.businessDate)}</td>
                  <td className="py-3 text-gray-500">{row.customerName ?? "-"}</td>
                  <td className="py-3 text-right">
                    {formatMoney(
                      getRevenueAmountByBasis(
                        {
                          exVat: row.salesAmountExVat,
                          incVat: row.salesAmountIncVat,
                        },
                        basis,
                      ),
                    )}
                  </td>
                  <td className="py-3 text-right">{formatMoney(row.costAmount)}</td>
                  <td
                    className={`py-3 text-right font-medium ${
                      row.grossProfit >= 0 ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {formatMoney(row.grossProfit)}
                  </td>
                  <td className="py-3 text-right">{formatPercent(row.marginPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SectionPagination
          currentPage={currentInvoicePage}
          totalPages={invoiceTotalPages}
          buildHref={(page) =>
            buildProfitDashboardHref({
              from: data.filters.from,
              to: data.filters.to,
              basis,
              stockPage: currentStockPage,
              customerPage: currentCustomerPage,
              invoicePage: page,
            })
          }
        />
      </section>
    </div>
  );
};

export default ProfitDashboard;

