"use client";

import dynamic from "next/dynamic";

const SalesChart = dynamic(() => import("./SalesChart"), {
  ssr: false,
  loading: () => <div className="h-72 rounded-xl bg-white animate-pulse" />,
});

const TopProductsChart = dynamic(() => import("./TopProductsChart"), {
  ssr: false,
  loading: () => <div className="h-72 rounded-xl bg-white animate-pulse" />,
});

export default function AdminDashboardCharts() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2">
        <SalesChart />
      </div>
      <div>
        <TopProductsChart />
      </div>
    </div>
  );
}
