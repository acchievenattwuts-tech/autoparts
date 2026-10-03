import { Lock } from "lucide-react";

import AdminPageHeader from "@/components/shared/AdminPageHeader";
import { getPurchaseBudgetDashboardData, type PurchaseBudgetDashboardData } from "@/lib/purchase-budget-dashboard";

import { BUDGET_MUTED_PANEL_CLASS, BUDGET_SECTION_CLASS, formatBaht } from "@/components/shared/purchase-budget-ui";
import { BudgetBreakdown, BudgetCardHeader, BudgetCashCompare, BudgetHero, BudgetRules } from "./PurchaseBudgetCard";
import PurchaseBudgetCapDialog from "./PurchaseBudgetCapDialog";
import { BudgetDepositsPanel, BudgetHistoryPanel, BudgetMovementsPanel } from "./PurchaseBudgetPanels";

type PurchaseBudgetTabProps = {
  canManage: boolean;
  canViewCash: boolean;
  canViewAuditLog: boolean;
};

const PageHeader = () => (
  <AdminPageHeader
    className="mb-0"
    eyebrow="Dashboard"
    title="Purchase Budget"
    description="ดูว่ายังสั่งซื้อสินค้าได้อีกเท่าไรก่อนถึงเพดานที่ตั้งไว้"
  />
);

export const PurchaseBudgetTabSkeleton = () => (
  <div className="space-y-4" aria-busy="true" aria-label="กำลังโหลดงบสั่งซื้อ">
    <PageHeader />
    <div className={`${BUDGET_SECTION_CLASS} animate-pulse`}>
      <div className="h-10 w-56 rounded-lg bg-slate-100 dark:bg-white/10" />
      <div className="mt-4 h-12 w-72 rounded-lg bg-slate-100 dark:bg-white/10" />
      <div className="mt-4 h-2.5 w-full rounded-full bg-slate-100 dark:bg-white/10" />
      <div className="mt-6 h-40 w-full rounded-xl bg-slate-100 dark:bg-white/10" />
    </div>
  </div>
);

const UnsetCard = ({ data, canManage }: { data: PurchaseBudgetDashboardData; canManage: boolean }) => {
  const used = data.totals.stockValue + data.totals.depositOutstanding;
  return (
    <section className={`flex flex-col gap-4 ${BUDGET_SECTION_CLASS}`}>
      <BudgetCardHeader
        subtitle={`ข้อมูล ณ ${data.asOf}`}
        level="unset"
        action={canManage ? <PurchaseBudgetCapDialog variant="setup" cap={null} thresholdPct={data.settings.thresholdPct} used={used} /> : null}
      />
      <p className="font-kanit text-lg font-semibold text-slate-900 dark:text-slate-100">ยังไม่ได้ตั้งเพดานงบสั่งซื้อ</p>
      <div className={`max-w-md text-sm ${BUDGET_MUTED_PANEL_CLASS}`}>
        <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">มูลค่าที่ใช้อยู่ตอนนี้</p>
        <div className="flex justify-between gap-2"><span className="text-slate-600 dark:text-slate-300">สต็อก (ราคาทุน)</span><span className="tabular-nums">{formatBaht(data.totals.stockValue)}</span></div>
        <div className="flex justify-between gap-2"><span className="text-slate-600 dark:text-slate-300">มัดจำรอรับของ</span><span className="tabular-nums">{formatBaht(data.totals.depositOutstanding)}</span></div>
        <div className="mt-1 flex justify-between gap-2 border-t border-slate-200 pt-1 font-bold dark:border-white/10"><span>รวม</span><span className="tabular-nums">{formatBaht(used)}</span></div>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300">ตั้งเพดานให้สูงกว่ายอดรวมนี้ ส่วนที่เกินคืองบที่ยังสั่งซื้อได้</p>
      {canManage ? null : (
        <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <Lock size={14} aria-hidden /> ให้ผู้ที่มีสิทธิ์ปรับงบเป็นผู้ตั้งเพดาน
        </p>
      )}
    </section>
  );
};

const PurchaseBudgetTab = async ({ canManage, canViewCash, canViewAuditLog }: PurchaseBudgetTabProps) => {
  let data: PurchaseBudgetDashboardData;
  try {
    data = await getPurchaseBudgetDashboardData({ canViewCash });
  } catch (error) {
    console.error("[purchase-budget] dashboard load failed", error instanceof Error ? error.message : "unknown");
    return (
      <div className="space-y-4">
        <PageHeader />
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300">
          โหลดข้อมูลงบสั่งซื้อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง
        </p>
      </div>
    );
  }

  const { figures } = data;
  if (!figures) {
    return (
      <div className="space-y-4">
        <PageHeader />
        <UnsetCard data={data} canManage={canManage} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader />
      <section className={`flex flex-col gap-4 ${BUDGET_SECTION_CLASS}`}>
        <BudgetCardHeader
          subtitle={`เพดานงบ ลบมูลค่าสต็อก (ราคาทุน) และมัดจำที่รอรับของ · ข้อมูล ณ ${data.asOf}`}
          level={figures.level}
          action={canManage ? <PurchaseBudgetCapDialog variant="adjust" cap={figures.cap} thresholdPct={figures.thresholdPct} used={figures.used} /> : null}
        />
        <div className="flex flex-wrap gap-4">
          <BudgetHero figures={figures} />
          <BudgetBreakdown figures={figures} depositCount={data.totals.depositCount} />
        </div>
        <BudgetRules />
        <BudgetCashCompare cash={data.cash} />
        <div className="flex flex-wrap items-start gap-3">
          {data.movements ? <BudgetMovementsPanel movements={data.movements} remaining={figures.remaining} /> : null}
          <BudgetDepositsPanel deposits={data.deposits} total={data.totals.depositOutstanding} truncated={data.depositsTruncated} />
          <BudgetHistoryPanel history={data.history} canViewAuditLog={canViewAuditLog} />
        </div>
      </section>
    </div>
  );
};

export default PurchaseBudgetTab;
