import {
  StatCard,
  fmtMoney,
} from "./summary-presentation";
import { getLineDailySummaryForDay } from "./summary-loader";

/** Stat cards for the LINE daily summary — awaits the summary build. */
export default async function LineDailySummaryStatCards({
  reportDayKey,
  compactMode,
}: {
  reportDayKey: string;
  compactMode: boolean;
}) {
  const summary = await getLineDailySummaryForDay(reportDayKey, compactMode);
  const totalRiskItems = summary.counts.lowStockCount + summary.counts.outOfStockCount;

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <StatCard title="ยอดขายวันนี้" value={`฿${fmtMoney(summary.money.salesTotal)}`} />
      <StatCard title="เงินรับเข้าวันนี้" value={`฿${fmtMoney(summary.money.cashInTotal)}`} />
      <StatCard
        title="ลูกหนี้ + COD คงค้าง"
        value={`฿${fmtMoney(summary.money.arOutstanding + summary.money.codOutstanding)}`}
      />
      <StatCard
        title="สต๊อกเสี่ยงวันนี้"
        value={`${totalRiskItems} รายการ`}
        tone={totalRiskItems > 0 ? "warn" : "default"}
      />
    </div>
  );
}
