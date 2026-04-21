"use client";

import { useState, type ReactNode } from "react";

type DashboardTabsProps = {
  initialTab?: "daily" | "profit";
  dailyContent: ReactNode;
  profitContent: ReactNode;
};

const DashboardTabs = ({
  initialTab = "daily",
  dailyContent,
  profitContent,
}: DashboardTabsProps) => {
  const [activeTab, setActiveTab] = useState<"daily" | "profit">(initialTab);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-sm dark:border-white/10 dark:bg-[#111827]">
        <button
          type="button"
          onClick={() => setActiveTab("daily")}
          className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
            activeTab === "daily"
              ? "bg-gray-900 text-white dark:bg-slate-100 dark:text-slate-900"
              : "text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-white/10"
          }`}
        >
          Daily Operations
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("profit")}
          className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
            activeTab === "profit"
              ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-slate-950"
              : "text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-white/10"
          }`}
        >
          Profit Dashboard
        </button>
      </div>

      <div className={activeTab === "daily" ? "block" : "hidden"}>{dailyContent}</div>
      <div className={activeTab === "profit" ? "block" : "hidden"}>{profitContent}</div>
    </div>
  );
};

export default DashboardTabs;
