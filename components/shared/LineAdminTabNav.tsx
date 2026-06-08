"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import LinkPendingIndicator from "@/components/shared/LinkPendingIndicator";

type LineAdminTabNavProps = {
  canViewConversations: boolean;
  canViewPaymentSlips: boolean;
};

const TABS = [
  {
    label: "LINE OA Conversations",
    href: "/admin/line-conversations",
    key: "conversations",
  },
  {
    label: "สลิปการชำระเงิน (LINE)",
    href: "/admin/line-payment-slips",
    key: "payment-slips",
  },
] as const;

export default function LineAdminTabNav({
  canViewConversations,
  canViewPaymentSlips,
}: LineAdminTabNavProps) {
  const pathname = usePathname();
  const visibleTabs = TABS.filter((tab) => {
    if (tab.key === "conversations") return canViewConversations;
    return canViewPaymentSlips;
  });

  if (visibleTabs.length <= 1) return null;

  return (
    <div className="flex flex-wrap gap-1 border-b border-gray-200 pb-0 dark:border-white/10">
      {visibleTabs.map((tab) => {
        const active = pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`inline-flex items-center gap-2 rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-[#1e3a5f] bg-white text-[#1e3a5f] dark:border-sky-300 dark:bg-slate-900 dark:text-sky-200"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-slate-400 dark:hover:border-white/20 dark:hover:text-slate-200"
            }`}
          >
            {tab.label}
            <LinkPendingIndicator className={active ? "text-current" : "text-gray-400"} />
          </Link>
        );
      })}
    </div>
  );
}
