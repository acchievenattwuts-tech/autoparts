export const dynamic = "force-dynamic";

import DailyOperationsDashboard from "./DailyOperationsDashboard";
import DashboardTabs from "./DashboardTabs";
import ProfitDashboard from "./ProfitDashboard";

import { requirePermission } from "@/lib/require-auth";

type AdminDashboardPageProps = {
  searchParams?: Promise<{
    tab?: string;
    profitFrom?: string;
    profitTo?: string;
    profitBasis?: string;
    profitStockPage?: string;
    profitCustomerPage?: string;
    profitInvoicePage?: string;
  }>;
};

const AdminDashboardPage = async ({ searchParams }: AdminDashboardPageProps) => {
  await requirePermission("dashboard.view");

  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  return (
    <DashboardTabs
      initialTab={resolvedSearchParams?.tab === "profit" ? "profit" : "daily"}
      dailyContent={<DailyOperationsDashboard />}
      profitContent={
        <ProfitDashboard
          key={[
            resolvedSearchParams?.profitFrom ?? "",
            resolvedSearchParams?.profitTo ?? "",
            resolvedSearchParams?.profitBasis ?? "",
            resolvedSearchParams?.profitStockPage ?? "",
            resolvedSearchParams?.profitCustomerPage ?? "",
            resolvedSearchParams?.profitInvoicePage ?? "",
          ].join("|")}
          profitFrom={resolvedSearchParams?.profitFrom}
          profitTo={resolvedSearchParams?.profitTo}
          profitBasis={resolvedSearchParams?.profitBasis}
          profitStockPage={resolvedSearchParams?.profitStockPage}
          profitCustomerPage={resolvedSearchParams?.profitCustomerPage}
          profitInvoicePage={resolvedSearchParams?.profitInvoicePage}
        />
      }
    />
  );
};

export default AdminDashboardPage;
