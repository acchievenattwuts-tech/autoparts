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

const resolveInitialTab = (tab: string | undefined): DashboardTabKey => {
  if (tab === "profit" || tab === "budget") return tab;
  return "daily";
};

const AdminDashboardPage = async ({ searchParams }: AdminDashboardPageProps) => {
  await requirePermission("dashboard.view");

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const { role, permissions } = await getSessionPermissionContext();
  const canViewBudget = hasPermissionAccess(role, permissions, "purchase_budget.view");

  return (
    <DashboardTabs
      initialTab={resolveInitialTab(resolvedSearchParams?.tab)}
      dailyContent={
        <div className="space-y-4">
          <ShopeeChannelSummary />
          <DailyOperationsDashboard />
        </div>
      }
      profitContent={
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
      }
      budgetContent={
        canViewBudget ? (
          <Suspense fallback={<PurchaseBudgetTabSkeleton />}>
            <PurchaseBudgetTab
              canManage={hasPermissionAccess(role, permissions, "purchase_budget.manage")}
              canViewCash={hasPermissionAccess(role, permissions, "cash_bank.view")}
              canViewAuditLog={hasPermissionAccess(role, permissions, "audit_log.view")}
            />
          </Suspense>
        ) : undefined
      }
    />
  );
};

export default AdminDashboardPage;
