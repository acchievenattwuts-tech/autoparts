"use client";

import dynamic from "next/dynamic";

import type { SalesChartDatum } from "./SalesChart";
import type { TopProductsChartDatum } from "./TopProductsChart";

const SalesChart = dynamic(() => import("./SalesChart"), {
  ssr: false,
  loading: () => <div className="h-72 rounded-xl bg-white animate-pulse" />,
});

const TopProductsChart = dynamic(() => import("./TopProductsChart"), {
  ssr: false,
  loading: () => <div className="h-72 rounded-xl bg-white animate-pulse" />,
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
