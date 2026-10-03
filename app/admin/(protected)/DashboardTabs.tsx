"use client";

import { useState, type ReactNode } from "react";

export type DashboardTabKey = "daily" | "profit" | "budget";

type DashboardTabsProps = {
  initialTab?: DashboardTabKey;
  dailyContent: ReactNode;
  profitContent: ReactNode;
  /** Purchase Budget tab — passed only when the viewer holds purchase_budget.view. */
  budgetContent?: ReactNode;
};

const DashboardTabs = ({
  initialTab = "daily",
  dailyContent,
  profitContent,
  budgetContent,
}: DashboardTabsProps) => {
  const [activeTab, setActiveTab] = useState<DashboardTabKey>(
    initialTab === "budget" && !budgetContent ? "daily" : initialTab,
  );

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
        {budgetContent ? (
          <button
            type="button"
            onClick={() => setActiveTab("budget")}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              activeTab === "budget"
                ? "bg-indigo-600 text-white dark:bg-indigo-400 dark:text-slate-950"
                : "text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-white/10"
            }`}
          >
            Purchase Budget
          </button>
        ) : null}
      </div>

      <div className={activeTab === "daily" ? "block" : "hidden"}>{dailyContent}</div>
      <div className={activeTab === "profit" ? "block" : "hidden"}>{profitContent}</div>
      {budgetContent ? (
        <div className={activeTab === "budget" ? "block" : "hidden"}>{budgetContent}</div>
      ) : null}
    </div>
  );
};

export default DashboardTabs;
