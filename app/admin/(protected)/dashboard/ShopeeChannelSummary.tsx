import { AlertTriangle, PackageCheck, Store, TrendingUp } from "lucide-react";

import { getShopeeReportingSummary } from "@/lib/shopee/services/reporting";
import { getThailandDateKey, parseDateOnlyToStartOfDay } from "@/lib/th-date";

/**
 * Additive dashboard widget: month-to-date sales split by channel
 * (หน้าร้าน vs Shopee). Self-contained server component — does not touch the
 * existing daily/profit dashboards.
 */
const fmt = (value: number) =>
  value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ShopeeChannelSummary = async () => {
  const [year, month] = getThailandDateKey().split("-");
  const monthStart = parseDateOnlyToStartOfDay(`${year}-${month}-01`);

  const summary = await getShopeeReportingSummary({ from: monthStart, to: new Date() });

  const cards = [
    {
      key: "store",
      label: "หน้าร้าน",
      icon: TrendingUp,
      amount: summary.store.salesAmount,
      grossProfit: summary.store.grossProfit,
      count: summary.store.orderCount,
      className: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200",
    },
    {
      key: "shopee",
      label: "Shopee",
      icon: Store,
      amount: summary.shopee.salesAmount,
      grossProfit: summary.shopee.grossProfit,
      count: summary.shopee.orderCount,
      className: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-200",
    },
  ];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#0d1728]">
      <h2 className="font-kanit text-sm font-semibold text-slate-900 dark:text-slate-100">ยอดขายแยกช่องทาง (เดือนนี้)</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <div key={card.key} className={`rounded-xl border px-4 py-3 ${card.className}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <card.icon size={20} />
                <div>
                  <p className="text-sm font-medium">{card.label}</p>
                  <p className="text-xs opacity-80">{card.count} ออเดอร์</p>
                </div>
              </div>
              <p className="text-lg font-bold tabular-nums">{fmt(card.amount)}</p>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-current/15 pt-2 text-xs">
              <span className="opacity-80">Gross profit</span>
              <span className="font-semibold tabular-nums">{fmt(card.grossProfit)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
          <div className="flex items-center gap-3">
            <AlertTriangle size={18} />
            <div>
              <p className="text-sm font-medium">Stock risk</p>
              <p className="text-xs opacity-80">{summary.stockRisk.pushEnabled} mapping เปิด push</p>
            </div>
          </div>
          <p className="text-sm font-bold tabular-nums">
            {summary.stockRisk.needsPush + summary.stockRisk.failed}
          </p>
        </div>
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200">
          <div className="flex items-center gap-3">
            <PackageCheck size={18} />
            <div>
              <p className="text-sm font-medium">Sync review</p>
              <p className="text-xs opacity-80">{summary.failedSyncJobs} job fail เดือนนี้</p>
            </div>
          </div>
          <p className="text-sm font-bold tabular-nums">{summary.reviewOrders}</p>
        </div>
      </div>
    </section>
  );
};

export default ShopeeChannelSummary;
