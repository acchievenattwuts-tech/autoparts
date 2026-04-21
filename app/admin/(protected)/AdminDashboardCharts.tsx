"use client";

import dynamic from "next/dynamic";

import { useOptionalAdminTheme } from "@/components/shared/AdminThemeProvider";

import type { SalesChartDatum } from "./SalesChart";
import type { TopProductsChartDatum } from "./TopProductsChart";

function ChartSkeleton() {
  const adminTheme = useOptionalAdminTheme();
  const isDark = adminTheme?.isDark ?? false;

  return (
    <div
      className={`h-72 overflow-hidden rounded-2xl border animate-pulse ${
        isDark
          ? "border-slate-800/80 bg-slate-950/70"
          : "border-gray-100 bg-white"
      }`}
      aria-hidden="true"
    >
      <div className={`h-full w-full ${isDark ? "bg-slate-900/80" : "bg-gray-50"}`} />
    </div>
  );
}

const SalesChart = dynamic(() => import("./SalesChart"), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

const TopProductsChart = dynamic(() => import("./TopProductsChart"), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

export default function AdminDashboardCharts({
  salesData,
  topProductsData,
}: {
  salesData: SalesChartDatum[];
  topProductsData: TopProductsChartDatum[];
}) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2">
        <SalesChart data={salesData} />
      </div>
      <div>
        <TopProductsChart data={topProductsData} />
      </div>
    </div>
  );
}
