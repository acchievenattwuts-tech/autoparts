"use client";

import Link from "next/link";
import LinkPendingIndicator from "@/components/shared/LinkPendingIndicator";
import type { SaleChannel } from "@/lib/generated/prisma";

const tabs: ReadonlyArray<{ channel: SaleChannel; label: string; accent: string }> = [
  { channel: "STORE", label: "ขายหน้าร้าน", accent: "border-orange-500 text-orange-700 dark:text-orange-300" },
  { channel: "SHOPEE", label: "Shopee", accent: "border-orange-500 text-orange-700 dark:text-orange-300" },
  { channel: "LAZADA", label: "Lazada", accent: "border-sky-500 text-sky-700 dark:text-sky-300" },
];

export default function SalesChannelTabs({ currentChannel }: { currentChannel: SaleChannel }) {
  return (
    <div className="flex items-center" role="tablist" aria-label="ช่องทางการขาย">
      {tabs.map((tab) => {
        const isActive = currentChannel === tab.channel;
        return (
          <Link
            key={tab.channel}
            href={`/admin/sales?channel=${tab.channel}`}
            role="tab"
            aria-selected={isActive}
            aria-current={isActive ? "page" : undefined}
            className={`relative inline-flex min-h-11 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? tab.accent
                : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <span>{tab.label}</span>
            <LinkPendingIndicator className="ml-0" />
          </Link>
        );
      })}
    </div>
  );
}
