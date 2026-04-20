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
      <div className="flex flex-wrap gap-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-sm">
        <button
          type="button"
          onClick={() => setActiveTab("daily")}
          className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
            activeTab === "daily"
              ? "bg-gray-900 text-white"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          Daily Operations
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("profit")}
          className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
            activeTab === "profit"
              ? "bg-emerald-600 text-white"
              : "text-gray-600 hover:bg-gray-100"
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
