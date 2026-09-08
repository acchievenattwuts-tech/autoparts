export const dynamic = "force-dynamic";

import DailyOperationsDashboard from "../DailyOperationsDashboard";
import DashboardTabs from "../DashboardTabs";
import ProfitDashboard from "../ProfitDashboard";
import ShopeeChannelSummary from "./ShopeeChannelSummary";

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
    profitAlertPage?: string;
  }>;
};

const AdminDashboardPage = async ({ searchParams }: AdminDashboardPageProps) => {
  await requirePermission("dashboard.view");

  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  return (
    <DashboardTabs
      initialTab={resolvedSearchParams?.tab === "profit" ? "profit" : "daily"}
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
    />
  );
};

export default AdminDashboardPage;
