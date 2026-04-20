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
          profitFrom={resolvedSearchParams?.profitFrom}
          profitTo={resolvedSearchParams?.profitTo}
          profitBasis={resolvedSearchParams?.profitBasis}
        />
      }
    />
  );
};

export default AdminDashboardPage;
