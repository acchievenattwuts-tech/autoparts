"use client";

import { useState } from "react";
import CategoryForm, { type CategoryFormProps } from "./CategoryForm";
import AiSuggestionsPanel, { type PendingSuggestion } from "./AiSuggestionsPanel";

type CategoriesTabsProps = CategoryFormProps & {
  pendingSuggestions: PendingSuggestion[];
};

type TabKey = "categories" | "ai";

const CategoriesTabs = ({ pendingSuggestions, ...categoryFormProps }: CategoriesTabsProps) => {
  const [tab, setTab] = useState<TabKey>("categories");
  const pendingCount = pendingSuggestions.length;

  const tabClass = (active: boolean) =>
    `rounded-full px-4 py-1.5 text-sm font-medium transition ${
      active
        ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
    }`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={tabClass(tab === "categories")} onClick={() => setTab("categories")}>
          หมวดหมู่สินค้า
        </button>
        <button type="button" className={tabClass(tab === "ai")} onClick={() => setTab("ai")}>
          AI เสนอ (รออนุมัติ)
          {pendingCount > 0 ? (
            <span className="ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">
              {pendingCount}
            </span>
          ) : null}
        </button>
      </div>

      {tab === "categories" ? (
        <CategoryForm {...categoryFormProps} />
      ) : (
        <AiSuggestionsPanel suggestions={pendingSuggestions} canReview={categoryFormProps.canUpdate} />
      )}
    </div>
  );
};

export default CategoriesTabs;
