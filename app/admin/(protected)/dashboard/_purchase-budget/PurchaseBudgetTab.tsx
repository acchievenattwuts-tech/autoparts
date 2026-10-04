import { Lock } from "lucide-react";

import AdminPageHeader from "@/components/shared/AdminPageHeader";
import { getPurchaseBudgetDashboardData, type PurchaseBudgetDashboardData } from "@/lib/purchase-budget-dashboard";

import { BUDGET_SECTION_CLASS } from "@/components/shared/purchase-budget-ui";
import { BudgetBreakdown, BudgetCardHeader, BudgetCashCompare, BudgetHero, BudgetRules } from "./PurchaseBudgetCard";
import PurchaseBudgetCapDialog from "./PurchaseBudgetCapDialog";
import PurchaseBudgetLedger from "./PurchaseBudgetLedger";
import { BudgetDepositsPanel, BudgetHistoryPanel } from "./PurchaseBudgetPanels";

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
    description="ดูว่ายังสั่งซื้อสินค้าได้อีกเท่าไรจากงบที่ตั้ง นับเฉพาะเอกสารตั้งแต่วันเริ่มนับ"
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

const UnsetCard = ({ data, canManage }: { data: PurchaseBudgetDashboardData; canManage: boolean }) => (
  <section className={`flex flex-col gap-4 ${BUDGET_SECTION_CLASS}`}>
    <BudgetCardHeader
      subtitle={`ข้อมูล ณ ${data.asOf}`}
      level="unset"
      action={canManage ? <PurchaseBudgetCapDialog variant="setup" budget={null} thresholdPct={data.settings.thresholdPct} remaining={null} /> : null}
    />
    <p className="font-kanit text-lg font-semibold text-slate-900 dark:text-slate-100">ยังไม่ได้ตั้งงบสั่งซื้อ</p>
    <p className="max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
      ตั้งงบและวันที่เริ่มนับ แล้วระบบจะหักงบเมื่อบันทึกใบซื้อ และบวกงบเท่าต้นทุนของสินค้าที่ขาย
      นับเฉพาะเอกสารที่ลงวันที่ตั้งแต่วันเริ่มนับ ของในสต็อกเดิมไม่หักงบ
    </p>
    {canManage ? null : (
      <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <Lock size={14} aria-hidden /> ให้ผู้ที่มีสิทธิ์ปรับงบเป็นผู้ตั้งงบ
      </p>
    )}
  </section>
);

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

  const startedOnLabel = data.startedOnLabel ?? "-";
  return (
    <div className="space-y-4">
      <PageHeader />
      <BudgetRules />
      <section className={`flex flex-col gap-4 ${BUDGET_SECTION_CLASS}`}>
        <BudgetCardHeader
          subtitle={`งบที่ตั้ง − ซื้อเข้า + ต้นทุนสินค้าที่ขาย ± รายการสต็อกอื่น ตั้งแต่ ${startedOnLabel} · ข้อมูล ณ ${data.asOf}`}
          level={figures.level}
          action={canManage ? <PurchaseBudgetCapDialog variant="adjust" budget={figures.budget} thresholdPct={figures.thresholdPct} remaining={figures.remaining} /> : null}
        />
        <div className="flex flex-wrap gap-4">
          <BudgetHero figures={figures} startedOnLabel={startedOnLabel} />
          <BudgetBreakdown figures={figures} startedOnLabel={startedOnLabel} />
        </div>
        <PurchaseBudgetLedger />
        <BudgetCashCompare cash={data.cash} />
        <div className="flex flex-wrap items-start gap-3">
          <BudgetDepositsPanel deposits={data.deposits} total={data.depositsTotalRemaining} truncated={data.depositsTruncated} />
          <BudgetHistoryPanel history={data.history} canViewAuditLog={canViewAuditLog} />
        </div>
      </section>
    </div>
  );
};

export default PurchaseBudgetTab;
