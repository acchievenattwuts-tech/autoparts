"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type MouseEvent, type ReactNode } from "react";

export type DashboardTabKey = "daily" | "profit" | "budget";

type DashboardTabsProps = {
  activeTab: DashboardTabKey;
  /** One href per visible tab. `budget` is present only when the viewer holds purchase_budget.view. */
  hrefs: Partial<Record<DashboardTabKey, string>>;
  /** Content of the active tab only — the server renders nothing for the other tabs. */
  children: ReactNode;
};

const TABS: { key: DashboardTabKey; label: string; activeClassName: string }[] = [
  { key: "daily", label: "Daily Operations", activeClassName: "bg-gray-900 text-white dark:bg-slate-100 dark:text-slate-900" },
  { key: "profit", label: "Profit Dashboard", activeClassName: "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-slate-950" },
  { key: "budget", label: "Purchase Budget", activeClassName: "bg-indigo-600 text-white dark:bg-indigo-400 dark:text-slate-950" },
];

const INACTIVE_TAB_CLASS = "text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-white/10";

/**
 * Tab bar of /admin/dashboard. Each tab is a navigation to `?tab=<key>`, so the
 * server loads only the open tab's data (it used to render all three tabs and
 * hide two with CSS, running every tab's queries on each visit and on each
 * profit-table page change). The transition keeps the current tab on screen,
 * marks the clicked tab right away and shows a spinner until it arrives.
 */
const DashboardTabs = ({ activeTab, hrefs, children }: DashboardTabsProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingTab, setPendingTab] = useState<DashboardTabKey | null>(null);

  const shownTab = isPending && pendingTab ? pendingTab : activeTab;

  const navigate =
    (key: DashboardTabKey, href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
        return;
      }

      event.preventDefault();
      if (isPending || key === activeTab) return;

      setPendingTab(key);
      startTransition(() => {
        router.push(href, { scroll: false });
      });
    };

  return (
    <div className="space-y-6">
      <nav
        aria-label="แท็บ Dashboard"
        className="flex flex-wrap gap-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-sm dark:border-white/10 dark:bg-[#111827]"
      >
        {TABS.map((tab) => {
          const href = hrefs[tab.key];
          if (!href) return null;
          const isShown = shownTab === tab.key;
          const isLoading = isPending && pendingTab === tab.key;
          return (
            <Link
              key={tab.key}
              href={href}
              prefetch={false}
              scroll={false}
              onClick={navigate(tab.key, href)}
              aria-current={tab.key === activeTab ? "page" : undefined}
              className={`relative rounded-xl px-4 py-2 text-sm font-medium transition ${
                isShown ? tab.activeClassName : INACTIVE_TAB_CLASS
              }`}
            >
              {tab.label}
              {isLoading ? (
                <LoaderCircle
                  size={12}
                  aria-hidden="true"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 animate-spin"
                />
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div
        aria-busy={isPending}
        className={`transition-opacity ${isPending ? "pointer-events-none opacity-60" : ""}`}
      >
        {children}
      </div>
    </div>
  );
};

export default DashboardTabs;
