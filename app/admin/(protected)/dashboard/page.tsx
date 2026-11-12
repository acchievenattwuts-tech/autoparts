export const dynamic = "force-dynamic";

import { Suspense } from "react";

import DailyOperationsDashboard from "../DailyOperationsDashboard";
import DashboardTabs, { type DashboardTabKey } from "../DashboardTabs";
import ProfitDashboard from "../ProfitDashboard";
import ShopeeChannelSummary from "./ShopeeChannelSummary";
import PurchaseBudgetTab, { PurchaseBudgetTabSkeleton } from "./_purchase-budget/PurchaseBudgetTab";

import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";

type AdminDashboardPageProps = {
  searchParams?: Promise<{
    tab?: string;
    profitFrom?: string;
    profitTo?: string;
    profitBasis?: string;
    profitStockPage?: string;
    profitCustomerPage?: string;
    profitInvoicePage?: string;
    profitAlertPage?: string;
  }>;
};

type DashboardSearchParams = NonNullable<Awaited<AdminDashboardPageProps["searchParams"]>>;

/** Query keys the dashboard reads; switching tabs keeps them so the profit filters survive a round trip. */
const PRESERVED_QUERY_KEYS = [
  "profitFrom",
  "profitTo",
  "profitBasis",
  "profitStockPage",
  "profitCustomerPage",
  "profitInvoicePage",
  "profitAlertPage",
] as const satisfies readonly (keyof DashboardSearchParams)[];

const resolveActiveTab = (tab: string | undefined, canViewBudget: boolean): DashboardTabKey => {
  if (tab === "profit") return "profit";
  if (tab === "budget" && canViewBudget) return "budget";
  return "daily";
};

const buildTabHref = (tab: DashboardTabKey, searchParams: DashboardSearchParams | undefined): string => {
  const params = new URLSearchParams({ tab });
  for (const key of PRESERVED_QUERY_KEYS) {
    const value = searchParams?.[key];
    // A repeated query key arrives as an array at runtime; keep only plain values.
    if (typeof value === "string" && value) params.set(key, value);
  }
  return `/admin/dashboard?${params.toString()}`;
};

const AdminDashboardPage = async ({ searchParams }: AdminDashboardPageProps) => {
  await requirePermission("dashboard.view");

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const { role, permissions } = await getSessionPermissionContext();
  const canViewBudget = hasPermissionAccess(role, permissions, "purchase_budget.view");
  const activeTab = resolveActiveTab(resolvedSearchParams?.tab, canViewBudget);

  // Only the open tab is rendered, so only its queries run.
  return (
    <DashboardTabs
      activeTab={activeTab}
      hrefs={{
        daily: buildTabHref("daily", resolvedSearchParams),
        profit: buildTabHref("profit", resolvedSearchParams),
        ...(canViewBudget ? { budget: buildTabHref("budget", resolvedSearchParams) } : {}),
      }}
    >
      {activeTab === "daily" ? (
        <div className="space-y-4">
          <ShopeeChannelSummary />
          <DailyOperationsDashboard />
        </div>
      ) : null}
      {activeTab === "profit" ? (
        <ProfitDashboard
          /* key มีเฉพาะช่วงวิเคราะห์ ไม่รวมเลขหน้าของตาราง เพราะการใส่เลขหน้าไว้ด้วย
             ทำให้กดเปลี่ยนหน้าตารางเดียวแล้ว React unmount ทั้ง dashboard ทิ้ง กราฟ
             แนวโน้ม (lazy recharts) กับการ์ด KPI จึงกระพริบใหม่ทุกครั้ง */
          key={[
            resolvedSearchParams?.profitFrom ?? "",
            resolvedSearchParams?.profitTo ?? "",
            resolvedSearchParams?.profitBasis ?? "",
          ].join("|")}
          profitFrom={resolvedSearchParams?.profitFrom}
          profitTo={resolvedSearchParams?.profitTo}
          profitBasis={resolvedSearchParams?.profitBasis}
          profitStockPage={resolvedSearchParams?.profitStockPage}
          profitCustomerPage={resolvedSearchParams?.profitCustomerPage}
          profitInvoicePage={resolvedSearchParams?.profitInvoicePage}
          profitAlertPage={resolvedSearchParams?.profitAlertPage}
        />
      ) : null}
      {activeTab === "budget" ? (
        <Suspense fallback={<PurchaseBudgetTabSkeleton />}>
          <PurchaseBudgetTab
            canManage={hasPermissionAccess(role, permissions, "purchase_budget.manage")}
            canViewCash={hasPermissionAccess(role, permissions, "cash_bank.view")}
            canViewAuditLog={hasPermissionAccess(role, permissions, "audit_log.view")}
          />
        </Suspense>
      ) : null}
    </DashboardTabs>
  );
};

export default AdminDashboardPage;
